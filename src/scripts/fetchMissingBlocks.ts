import { connectDB } from '../utils/db.js';
import Block from '../models/block.model.js';
import { createAztecNodeClient } from '@aztec-labs/aztec.js/node';
import Transaction from '../models/transaction.model.js';
import { BlockNumber } from '@aztec-labs/foundation/branded-types';

const { PXE_URL = 'http://188.40.109.171:8080' } = process.env;

/**
 * Script to fetch and index specific missing blocks
 */
async function main() {
  try {
    // Parse command line arguments
    const args = process.argv.slice(2);
    
    // Handle --help flag
    if (args.includes('--help') || args.includes('-h')) {
      console.log(`
Usage: yarn fetch-missing-blocks [options]

Options:
  --from=<number>    Start block number (default: first missing block)
  --to=<number>      End block number (default: latest chain block)
  --all              Fetch all missing blocks by checking for gaps
  --help, -h         Show this help message

Examples:
  yarn fetch-missing-blocks --from=100 --to=200   Fetch blocks 100 to 200
  yarn fetch-missing-blocks --all                 Find and fetch all missing blocks
      `);
      process.exit(0);
      return;
    }
    
    // Connect to the database
    await connectDB();
    console.log('Connected to database');
    
    // Connect to Aztec node
    const jsonRpcClient = createAztecNodeClient(PXE_URL);
    console.log(`Connected to Aztec node at ${PXE_URL}`);
    
    // Get the latest block number from the chain
    const latestBlockNumber = await jsonRpcClient.getBlockNumber();
    console.log(`Latest block number on chain: ${latestBlockNumber}`);

    // Get range to fetch (convert BlockNumber to plain number for iteration)
    let fromBlock = 0;
    let toBlock = Number(latestBlockNumber);
    
    // Parse command arguments
    const allFlag = args.includes('--all');
    
    // Parse from/to block arguments
    for (const arg of args) {
      if (arg.startsWith('--from=')) {
        fromBlock = parseInt(arg.substring(7), 10);
      } else if (arg.startsWith('--to=')) {
        toBlock = parseInt(arg.substring(5), 10);
      }
    }
    
    // Find all missing blocks if --all flag is used
    if (allFlag) {
      console.log('Finding all missing blocks...');
      
      // Get all block numbers from the database
      const storedBlocks = await Block.find({}, { number: 1, _id: 0 }).sort({ number: 1 });
      const storedBlockNumbers = new Set(storedBlocks.map(block => block.number));
      
      const missingBlocks: number[] = [];
      
      // Find missing blocks by comparing with expected sequence
      if (storedBlocks.length > 0) {
        const lowestBlock = storedBlocks[0].number;
        const highestBlock = storedBlocks[storedBlocks.length - 1].number;
        
        // Check for gaps
        for (let i = lowestBlock; i <= highestBlock; i++) {
          if (!storedBlockNumbers.has(i)) {
            missingBlocks.push(i);
          }
        }
        
        // Check for missing blocks at the end
        if (highestBlock < Number(latestBlockNumber)) {
          for (let i = highestBlock + 1; i <= Number(latestBlockNumber); i++) {
            missingBlocks.push(i);
          }
        }
      } else {
        // No blocks in database, fetch all from genesis to latest
        for (let i = 1; i <= Number(latestBlockNumber); i++) {
          missingBlocks.push(i);
        }
      }
      
      console.log(`Found ${missingBlocks.length} missing blocks`);
      
      if (missingBlocks.length > 0) {
        // Sort missing blocks for efficiency
        missingBlocks.sort((a, b) => a - b);
        
        // Set from/to to the range of missing blocks
        fromBlock = missingBlocks[0];
        toBlock = missingBlocks[missingBlocks.length - 1];
        
        console.log(`Will fetch blocks from ${fromBlock} to ${toBlock} (with potential gaps)`);
        
        // Fetch each missing block
        let fetchedCount = 0;
        for (const blockNum of missingBlocks) {
          await fetchAndStoreBlock(blockNum, jsonRpcClient);
          fetchedCount++;
          
          // Log progress every 10 blocks
          if (fetchedCount % 10 === 0) {
            console.log(`Progress: ${fetchedCount}/${missingBlocks.length} blocks fetched`);
          }
        }
        
        console.log(`Completed fetching ${fetchedCount} missing blocks`);
      } else {
        console.log('No missing blocks found.');
      }
    } else {
      // Fetch a specific range
      console.log(`Fetching blocks from ${fromBlock} to ${toBlock}`);
      
      let fetchedCount = 0;
      for (let i = fromBlock; i <= toBlock; i++) {
        // Check if block already exists
        const existingBlock = await Block.findOne({ number: i });
        if (!existingBlock) {
          await fetchAndStoreBlock(i, jsonRpcClient);
          fetchedCount++;
          
          // Log progress every 10 blocks
          if (fetchedCount % 10 === 0) {
            console.log(`Progress: ${fetchedCount} blocks fetched, currently at block ${i}`);
          }
        }
      }
      
      console.log(`Completed fetching ${fetchedCount} blocks`);
    }
    
    process.exit(0);
  } catch (error) {
    console.error('Error:', error instanceof Error ? error.message : error);
    process.exit(1);
  }
}

/**
 * Fetch and store a specific block and its transactions
 */
async function fetchAndStoreBlock(blockNumber: number, jsonRpcClient: any) {
  try {
    // Fetch block from the Aztec node
    const block = await jsonRpcClient.getBlock(BlockNumber(blockNumber));
    
    if (!block) {
      console.error(`Block ${blockNumber} not found on chain`);
      return;
    }
    
    // Convert block to database format
    const tsDate = new Date(block.header.globalVariables.timestamp.toNumber() * 1000);
    const blockHash = await block.hash();
    
    const L2Block = new Block({
      hash: blockHash.toString(),
      number: block.header.globalVariables.blockNumber.toNumber(),
      timestamp: tsDate,
      coinbaseAccount: block.header.globalVariables.coinbase,
      totalFees: block.header.totalFees.toNumber(),
      feeRecipient: block.header.globalVariables.feeRecipient,
      txCount: block.body.txEffects.length,
      size: block.header.getSize(),
      feePerDaGas: block.header.globalVariables.gasFees.feePerDaGas.toNumber(),
      feePerL2Gas: block.header.globalVariables.gasFees.feePerL2Gas.toNumber(),
      endStateHash: block.getEndStateHash().toString('hex'),
      startStateHash: block.getStartStateHash().toString('hex'),
    });
    
    // Save block
    const { _id, ...L2BlockWithoutId } = L2Block.toObject();
    await Block.findOneAndUpdate(
      { number: block.header.globalVariables.blockNumber.toNumber() },
      L2BlockWithoutId,
      { upsert: true }
    );
    
    // Process transactions
    for (let i = 0; i < block.body.txEffects.length; i++) {
      const txEffect = block.body.txEffects[i];
      const noteHashes = txEffect.noteHashes;
      
      // @ts-ignore - Using any type for logs
      const publicLogs = txEffect.publicLogs.map((log: any) => {
        return log.toBuffer().toString('hex');
      });
      
      // @ts-ignore - Using any type for logs
      const privateLogs = txEffect.privateLogs.map((log: any) => {
        return log.toBuffer().toString('hex');
      });
      
      const TxEffect = new Transaction({
        hash: '0x' + txEffect.txHash.toString(),
        index: i,
        blockNumber: block.header.globalVariables.blockNumber.toNumber(),
        timestamp: tsDate,
        revertCode: txEffect.revertCode.getDescription(),
        transactionFee: txEffect.transactionFee.toString(),
        noteHashes: noteHashes.toString(),
        nullifiers: txEffect.nullifiers.toString(),
        l2ToL1Msgs: txEffect.l2ToL1Msgs.toString(),
        publicDataWrites: txEffect.publicDataWrites.toString(),
        unencryptedLogsLength: txEffect.publicLogs.length,
        uneencryptedLogs: publicLogs.join(','),
        encryptedLogs: privateLogs.join(','),
      });
      
      const { _id, ...TxEffectWithoutId } = TxEffect.toObject();
      await Transaction.findOneAndUpdate(
        { hash: '0x' + txEffect.txHash.toString() },
        TxEffectWithoutId,
        { upsert: true }
      );
    }
    
  } catch (error) {
    console.error(`Error fetching block ${blockNumber}:`, error instanceof Error ? error.message : error);
  }
}

// Run the main function
main(); 