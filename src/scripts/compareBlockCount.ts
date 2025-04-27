import { connectDB } from '../utils/db.js';
import Block from '../models/block.model.js';
import { createAztecNodeClient } from '@aztec/aztec.js';

const { PXE_URL = 'http://138.201.52.21:8080' } = process.env;

/**
 * Script to check for missing blocks by:
 * 1. Compare total count with highest block number 
 * 2. If different, find jumps by checking consecutive blocks
 * 3. Try to fetch missing blocks from the node client
 */
async function main() {
  try {
    // Connect to the database
    await connectDB();
    console.log('Connected to database');
    
    // Get block count from MongoDB
    const blockCount = await Block.countDocuments();
    console.log(`Total blocks in database: ${blockCount}`);
    
    // Get the highest block number stored in the database
    const highestStoredBlock = await Block.findOne().sort({ number: -1 }).limit(1);
    const highestBlockNumber = highestStoredBlock ? highestStoredBlock.number : 0;
    console.log(`Highest block number in database: ${highestBlockNumber}`);
    
    // If the highest block number matches the count, there are no missing blocks
    if (blockCount === highestBlockNumber) {
      console.log('No missing blocks. Block count equals highest block number.');
      process.exit(0);
      return;
    }
    
    console.log(`Missing blocks detected: Count=${blockCount}, Highest=${highestBlockNumber}`);
    console.log('Scanning for jumps in block sequence...');
    
    // Get all blocks sorted by number
    const blocks = await Block.find().sort({ number: 1 }).select('number');
    
    // Check for jumps in sequence
    const missingBlocks = [];
    for (let i = 0; i < blocks.length - 1; i++) {
      const currentBlock = blocks[i].number;
      const nextBlock = blocks[i + 1].number;
      
      // Check if there's a gap between current and next block
      if (nextBlock - currentBlock > 1) {
        console.log(`Jump found between blocks ${currentBlock} and ${nextBlock}`);
        
        // Add all missing block numbers in the gap
        for (let missingNum = currentBlock + 1; missingNum < nextBlock; missingNum++) {
          missingBlocks.push(missingNum);
        }
      }
    }
    
    if (missingBlocks.length > 0) {
      console.log(`Found ${missingBlocks.length} missing blocks in sequence`);
      
      if (missingBlocks.length <= 20) {
        console.log('Missing block numbers:', missingBlocks.join(', '));
      } else {
        const firstTen = missingBlocks.slice(0, 10);
        const lastTen = missingBlocks.slice(-10);
        console.log(`First 10 missing blocks: ${firstTen.join(', ')}`);
        console.log(`Last 10 missing blocks: ${lastTen.join(', ')}`);
      }
      
      // Try to fetch some of the missing blocks from the node
      console.log('\nAttempting to fetch missing blocks from the node...');
      const jsonRpcClient = createAztecNodeClient(PXE_URL);
      
      // Only check a limited number of blocks to avoid long wait times
      const blocksToCheck = missingBlocks.length <= 5 ? missingBlocks : missingBlocks.slice(0, 5);
      
      for (const blockNum of blocksToCheck) {
        try {
          console.log(`Checking block ${blockNum} on the node...`);
          const block = await jsonRpcClient.getBlock(blockNum);
          
          if (block) {
            console.log(`✅ Block ${blockNum} exists on the node:`);
            console.log(`   - Hash: ${(await block.hash()).toString()}`);
            console.log(`   - Number: ${block.header.globalVariables.blockNumber.toNumber()}`);
            console.log(`   - Timestamp: ${new Date(block.header.globalVariables.timestamp.toNumber() * 1000).toISOString()}`);
            console.log(`   - Transactions: ${block.body.txEffects.length}`);
          } else {
            console.log(`❌ Block ${blockNum} does not exist on the node.`);
          }
        } catch (error) {
          console.log(`❌ Error fetching block ${blockNum}: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
      }
      
      if (missingBlocks.length > 5) {
        console.log(`Note: Only checked 5/${missingBlocks.length} missing blocks. Run the script with specific block numbers to check more.`);
      }
      
      console.log('\nTo fix these missing blocks, run:');
      console.log('  yarn fetch-missing-blocks --all');
    } else {
      console.log('No jumps found in block sequence. This could mean there are duplicate blocks.');
    }
    
    process.exit(0);
  } catch (error) {
    console.error('Error:', error instanceof Error ? error.message : error);
    process.exit(1);
  }
}

// Run the main function
main(); 