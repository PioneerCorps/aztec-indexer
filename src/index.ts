import { getDeployedTestAccountsWallets, getInitialTestAccountsWallets } from '@aztec/accounts/testing';
import {
  createLogger,
  createPXEClient,
  createAztecNodeClient,
  waitForPXE,
  L2Block,
  Wallet,
  AccountWalletWithSecretKey,
  AztecAddress,
  FunctionArtifact,
  Logger,
  loadContractArtifact,
  Fr,
} from '@aztec/aztec.js';
import {
    TxEffect,
    TxHash,
} from '@aztec/stdlib/tx';
import { format } from 'util';
import { connectDB } from './utils/db.js';
import Transaction  from './models/transaction.model.js';
import Block  from './models/block.model.js';
import Note from './models/note.model.js';
import { Account } from './models/account.model.js';
import PendingTransaction from './models/pendingTransaction.model.js';
import { ContractClass } from './models/contractClass.model.js';
import { ZERO_ADDRESS } from './consts/consts.js';
import { FunctionAbi, FunctionType } from './interfaces/aztec.interfaces.js';
import { updateDailyStats } from './utils/stats.js';
import { BlockChecker } from './utils/blockChecker.js';
import Reorg from './models/reorg.model.js';

async function retryAsync<T>(
  fn: () => Promise<T>,
  retries: number = 5,
  delay: number = 1000,
  attempt: number = 1
): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    if (attempt > retries) {
      console.error(`[Retry Failed] After ${retries} attempts: ${error instanceof Error ? error.message : String(error)}`);
      throw error;
    }
    console.warn(`[Retry Attempt ${attempt}/${retries}] Error: ${error instanceof Error ? error.message : String(error)}. Retrying in ${delay / 1000}s...`);
    await new Promise(resolve => setTimeout(resolve, delay));
    return retryAsync(fn, retries, delay, attempt + 1);
  }
}

const { PXE_URL = 'http://138.201.52.21:8080' } = process.env;


async function main() {
    console.log('Starting Aztec Explorer');
    const logger = createLogger('token');
    console.log(PXE_URL)
    const pxe = createPXEClient(PXE_URL);
    pxe.getTxReceipt
    const jsonRpcClient = createAztecNodeClient(PXE_URL);
    logger.debug('Waiting for PXE');
    console.log('Waiting for PXE');
    //await waitForPXE(pxe, logger);
    logger.debug('PXE is ready');
    connectDB();
    
    // Initialize the block checker for finality and reorg detection
    const blockChecker = new BlockChecker(PXE_URL, Reorg);
    await blockChecker.initialize();
    
    // Schedule regular checks for block finality updates
    setInterval(async () => {
        console.log('Running scheduled check for block finality status...');
        await blockChecker.checkAndUpdateStatus();
    }, 30000); // Check every minute

    const blockNum = 1;

    let blocksArray: L2Block[] = [];
    type BlockTxEffect = {
        txEffect: TxEffect[];
        blockNumber: number;
        blockHash: string;
        timestamp: Date;
    };

    type ContractClassWithBlockInfo = {
        id: Fr;
        blockNumber: number;
        blockHash: string;
        txHash: string;
        timestamp: Date;
    }

    type AddressWithBlockInfo = {
        address: AztecAddress;
        blockNumber: number;
        blockHash: string;
        txHash: string;
        timestamp: Date;
    }

    let BlockTxEffects: BlockTxEffect[] = [];
    let txHashes: TxHash[] = [];
    let addresses: AddressWithBlockInfo[] = [];
    let contractClassesWithBlockInfo: ContractClassWithBlockInfo[] = [];

    //const registeredAccounts = await pxe.getRegisteredAccounts();
    //registeredAccounts.forEach(async (account) => {
    //    addresses.push(account.address);
    //});
    //const contracts = await pxe.getContracts();
    //contracts.forEach(async (contract) => {addresses.push(contract)});
    //console.log(await pxe.getNodeInfo())


    //Block Listener
    listenForNewBlocks2(blockNum, blocksArray,logger);
    //listenForNewBlocksPXE(blockNum,blocksArray,logger);
    
    // Adaptive block processing to handle backlog more efficiently
    const processBlocksToDb = async () => {
        // Process more blocks at once when backlog is larger
        const batchSize = blocksArray.length > 50 ? 10 : 1;
        let processedCount = 0;
        
        // Process a batch of blocks
        while (processedCount < batchSize && blocksArray.length > 0) {
            const block = blocksArray.shift();
            if (block) {
                console.log('Got Block: ', block.header.globalVariables.blockNumber.toNumber(), 
                          `(Queue: ${blocksArray.length} remaining)`);
                
                const tsDate = new Date(block.header.globalVariables.timestamp.toNumber()*1000);
                const L2Block = new Block({
                    hash: (await block.hash()).toString(),
                    number: block.header.globalVariables.blockNumber.toNumber(),
                    timestamp: tsDate,
                    coinbaseAccount: block.header.globalVariables.coinbase,
                    totalFees: block.header.totalFees.toNumber(),
                    feeRecipient: block.header.globalVariables.feeRecipient,
                    txCount: block.body.txEffects.length,
                    size: block.body.toBuffer().length,
                    feePerDaGas: block.header.globalVariables.gasFees.feePerDaGas.toNumber(),
                    feePerL2Gas: block.header.globalVariables.gasFees.feePerL2Gas.toNumber(),
                    endStateHash: block.getEndStateHash().toString('hex'),
                    startStateHash: block.getStartStateHash().toString('hex'),
                });

                // Ensure _id is not in L2Block
                const { _id, ...L2BlockWithoutId } = L2Block.toObject(); 

                BlockTxEffects.push({txEffect: block.body.txEffects, blockNumber: block.header.globalVariables.blockNumber.toNumber(), blockHash: (await block.hash()).toString(),timestamp: tsDate});
                
                try {
                    await Block.findOneAndUpdate(
                        {number: block.header.globalVariables.blockNumber.toNumber()}, 
                        L2BlockWithoutId, 
                        {upsert: true}
                    );
                    processedCount++;
                } catch (e) {
                    console.error('Error upserting block: ', e instanceof Error ? e.message : String(e));
                }
            }
        }
        
        // Set polling interval based on backlog size
        const nextDelay = blocksArray.length > 20 ? 10 : 1000; // Poll faster with larger backlog
        setTimeout(processBlocksToDb, nextDelay);
    };
    
    // Start the adaptive processing
    processBlocksToDb();

    //TX Listener
    const processTxEffects = async () => {
        // Process more transaction effects at once when backlog is larger
        const batchSize = BlockTxEffects.length > 20 ? 5 : 1;
        let processedCount = 0;
        
        // Process a batch of transaction effects
        while (processedCount < batchSize && BlockTxEffects.length > 0) {
            const blockTxEffect = BlockTxEffects.shift();
            if (blockTxEffect) {
                console.log(`Processing ${blockTxEffect.txEffect.length} transactions for block ${blockTxEffect.blockNumber} (Queue: ${BlockTxEffects.length} remaining)`);
                
                // Use Promise.all to process transactions in parallel for this block
                const txPromises = blockTxEffect.txEffect.map(async (txEffect, i) => {
                    const noteHashes = txEffect.noteHashes;
                    const privateLogs = txEffect.privateLogs.map((log) => {
                        return log.toBuffer().toString('hex');
                    });

                    const publicLogs = txEffect.publicLogs.map((log) => {
                        return log.toBuffer().toString('hex');
                    });

                    /*txEffect.publicLogs.forEach((log) => {
                        const chunkSize = 32;
                        const logBuffer = log.toBuffer();
                        for (let i = 0; i < logBuffer.length; i += chunkSize) {
                            addresses.push(new AztecAddress(logBuffer.subarray(i,i+32)));
                        }
                    });



                    txEffect.privateLogs.forEach((log) => {
                        const chunkSize = 32;
                        const logBuffer = log.toBuffer();
                        for (let i = 0; i < logBuffer.length; i += chunkSize) {
                            addresses.push(new AztecAddress(logBuffer.subarray(i,i+32)));
                        }
                    });*/
                    txEffect.privateLogs.forEach((log) => {
                        const logHexString = log.toBuffer().toString('hex');
                        const searchValueHex = "2ec28b91a5f838506d6042915005ff55cf7a0a5f889a83b11faed33a31b486f2";
                        const startIndexInHex = logHexString.indexOf(searchValueHex);

                        if (startIndexInHex !== -1) {
                            const valueEndIndexInHex = startIndexInHex + searchValueHex.length;
                            // Sonraki 32 bayt, hex'te 64 karakter anlamına gelir.
                            if (logHexString.length >= valueEndIndexInHex + 64) {
                                const addressHexString = logHexString.substring(valueEndIndexInHex, valueEndIndexInHex + 64);
                                const addressBytes = Buffer.from(addressHexString, 'hex');
                                addresses.push({
                                    address: new AztecAddress(addressBytes),
                                    blockNumber: blockTxEffect.blockNumber,
                                    blockHash: blockTxEffect.blockHash,
                                    txHash: txEffect.txHash.toString(),
                                    timestamp: blockTxEffect.timestamp,
                                });
                            }
                        }
                    })

                    var contractAddress: String[] = [];
                    var contractAddressLogs: String[] = [];

                    txEffect.contractClassLogs.forEach((log) => {
                        contractAddress.push(log.contractAddress.toBuffer().toString('hex'));
                        if(log.contractAddress.toBuffer().toString('hex') === "0000000000000000000000000000000000000000000000000000000000000003") {
                            contractClassesWithBlockInfo.push({
                                id: log.fields[1],
                                blockNumber: blockTxEffect.blockNumber,
                                blockHash: blockTxEffect.blockHash,
                                txHash: txEffect.txHash.toString(),
                                timestamp: blockTxEffect.timestamp,
                            })
                        }
                        var contractAddressLog: String[] = []; 
                        log.fields.forEach((field) => {
                            contractAddressLog.push(field.toBuffer().toString('hex'));
                        })
                        contractAddressLogs.push(contractAddressLog.join(','));                        
                    });

                    const TxEffect = new Transaction({
                        hash: txEffect.txHash.toString(),
                        index: i,
                        blockNumber: blockTxEffect.blockNumber,
                        blockHash: blockTxEffect.blockHash,
                        timestamp: blockTxEffect.timestamp,
                        revertCode: txEffect.revertCode.getDescription(),
                        transactionFee: txEffect.transactionFee.toNumber(),
                        noteHashes: noteHashes.toString(),
                        nullifiers: txEffect.nullifiers.toString(),
                        l2ToL1Msgs: txEffect.l2ToL1Msgs.toString(),
                        publicDataWrites: txEffect.publicDataWrites.toString(),
                        unencryptedLogsLength: txEffect.publicLogs.length,
                        uneencryptedLogs: publicLogs.join(','),
                        encryptedLogs: privateLogs.join(','),
                        contractAddress: contractAddress.join(','),
                        contractLogs: contractAddressLogs.join(','),
                    });
                    const { _id, ...TxEffectWithoutId } = TxEffect.toObject();
                    txHashes.push(txEffect.txHash);
                    
                    try {
                        await Transaction.findOneAndUpdate(
                            {hash: txEffect.txHash.toString()}, 
                            TxEffectWithoutId, 
                            {upsert: true}
                        );
                    } catch (e) {
                        console.error('Error updating transaction: ', e instanceof Error ? e.message : String(e));
                    }
                });
                
                try {
                    await Promise.all(txPromises);
                    processedCount++;
                } catch (e) {
                    console.error('Error batch processing transactions: ', e instanceof Error ? e.message : String(e));
                }
            }
        }
        
        // Set polling interval based on backlog size
        const nextDelay = BlockTxEffects.length > 10 ? 10 : 1000; // Poll faster with larger backlog
        setTimeout(processTxEffects, nextDelay);
    };
    
    // Start the adaptive processing
    processTxEffects();

    //note listener
    /*setInterval(async () => {
        if(txHashes.length > 0) {
            const txHash = txHashes.shift();
            const notes = await pxe.getNotes({txHash: txHash});
            notes.forEach(async (incomingNote) => {
                const note = new Note({
                    note: incomingNote.note.toBuffer().toString('hex'),
                    txHash: '0x'+incomingNote.txHash.toString(),
                    recipient: incomingNote.recipient.toString(),
                    contractAddress: incomingNote.contractAddress.toString(),
                    storageSlot: incomingNote.storageSlot.toString(),
                });
                const { _id, ...noteWithoutId } = note.toObject();
                addresses.push(incomingNote.recipient, incomingNote.contractAddress);
                Note.findOneAndUpdate({note: incomingNote.note.toBuffer().toString('hex'), txHash: incomingNote.txHash.toString()}, noteWithoutId, {upsert: true}).catch((error) => {
                    console.error('Error upserting note: ', error.message);
                });
            });
        }
    },300);*/

    // ContractClass Listener
    const processContractClassesToDb = async () => {
        const batchSize = contractClassesWithBlockInfo.length > 20 ? 5 : 1;
        let processedCount = 0;

        while (processedCount < batchSize && contractClassesWithBlockInfo.length > 0) {
            const contractClassWithBlockInfo = contractClassesWithBlockInfo.shift();
            if (contractClassWithBlockInfo) {
                console.log(`Processing contract class ${contractClassWithBlockInfo.id.toString()} for block ${contractClassWithBlockInfo.blockNumber} (Queue: ${contractClassesWithBlockInfo.length} remaining)`);
                try {
                    const contractClass = await retryAsync(() => jsonRpcClient.getContractClass(contractClassWithBlockInfo.id));
                    const functions: FunctionAbi[] = []; // Assuming functions are not directly available or needed here yet
                    if (contractClass) {
                        const contractClassDoc = new ContractClass({
                            id: contractClassWithBlockInfo.id.toString(),
                            artifactHash: contractClass.artifactHash.toString(),
                            privateFunctionsRoot: contractClass.privateFunctionsRoot.toString(),
                            packedBytecode: contractClass.packedBytecode,
                            version: contractClass.version,
                            blockHash: contractClassWithBlockInfo.blockHash,
                            blockNumber: contractClassWithBlockInfo.blockNumber,
                            txHash: contractClassWithBlockInfo.txHash,
                            publicFunctions: functions,
                            creationTimestamp: contractClassWithBlockInfo.timestamp,
                        });

                        const { _id, ...contractClassWithoutId } = contractClassDoc.toObject();
                        await ContractClass.findOneAndUpdate(
                            { id: contractClassWithBlockInfo.id.toString(), blockHash: contractClassWithBlockInfo.blockHash, blockNumber: contractClassWithBlockInfo.blockNumber },
                            contractClassWithoutId,
                            { upsert: true }
                        );
                        processedCount++;
                    }
                } catch (e) {
                    console.error('Error processing or upserting contract class: ', e instanceof Error ? e.message : String(e));
                    // Optionally, re-add to queue or handle error differently
                    // contractClassesWithBlockInfo.unshift(contractClassWithBlockInfo); // Re-add to front for retry
                }
            }
        }

        const nextDelay = contractClassesWithBlockInfo.length > 10 ? 100 : 1000; // Poll faster with larger backlog
        setTimeout(processContractClassesToDb, nextDelay);
    };

    processContractClassesToDb();

    // Account Listener
    const processAddressesToDb = async () => {
        const batchSize = addresses.length > 50 ? 10 : 1; // Adapt batch size based on queue length
        let processedCount = 0;

        while (processedCount < batchSize && addresses.length > 0) {
            const addressWithBlockInfo = addresses.shift();
            if (addressWithBlockInfo) {
                console.log(`Processing address ${addressWithBlockInfo.address.toString()} for block ${addressWithBlockInfo.blockNumber} (Queue: ${addresses.length} remaining)`);
                try {
                    const contract = await retryAsync(() => jsonRpcClient.getContract(addressWithBlockInfo.address));
                    if (contract) {
                        const contractClass = await retryAsync(() => jsonRpcClient.getContractClass(contract.currentContractClassId));
                        let byteCode: Buffer = Buffer.from('');
                        let privateFunctionsRoot = "";
                        let name = ''; // Initialize name
                        if (contractClass) {
                            byteCode = contractClass.packedBytecode;
                            privateFunctionsRoot = contractClass.privateFunctionsRoot.toString();
                            // If contractClass has an artifact with a name, you could use it:
                            // name = contractClass.artifact?.name || '';
                        }
                        
                        // Determine if it's a contract (e.g., based on deployer or other logic)
                        // For example, an account might have ZERO_ADDRESS as deployer
                        let isContract = true;
                        if (contract.deployer.toString() === ZERO_ADDRESS) {
                           // This logic might need refinement based on your definition of an "account" vs "contract"
                           // isContract = false; // Uncomment or adjust if needed
                        }

                        const functions: FunctionAbi[] = []; // Populate if function ABIs are needed and accessible

                        const accountDoc = new Account({
                            address: addressWithBlockInfo.address.toString(),
                            version: contract.version,
                            deployer: contract.deployer.toString(),
                            contractClassID: contract.currentContractClassId.toString(),
                            isContract: isContract,
                            balance: BigInt(0).toString(), // Balance likely needs a separate update mechanism
                            functions: functions,
                            byteCode: byteCode,
                            name: name,
                            privateFunctionsRoot: privateFunctionsRoot,
                            blockNumber: addressWithBlockInfo.blockNumber,
                            blockHash: addressWithBlockInfo.blockHash,
                            txHash: addressWithBlockInfo.txHash,
                            creationTimestamp: addressWithBlockInfo.timestamp,
                        });
                        const { _id, ...accountWithoutId } = accountDoc.toObject();
                        await Account.findOneAndUpdate(
                            { address: addressWithBlockInfo.address.toString() },
                            accountWithoutId,
                            { upsert: true }
                        );
                        processedCount++;
                    }
                } catch (e) {
                    console.error('Error processing or upserting account: ', e instanceof Error ? e.message : String(e));
                    // Optional: re-queue the item if processing failed and is retryable
                    // addresses.unshift(addressWithBlockInfo);
                }
            }
        }

        // Set polling interval based on backlog size
        const nextDelay = addresses.length > 20 ? 100 : 1000; // Poll faster with larger backlog
        setTimeout(processAddressesToDb, nextDelay);
    };

    processAddressesToDb();

    // Add daily stats update interval (runs every hour)
    setInterval(async () => {
        console.log('Updating daily statistics...');
        await updateDailyStats();
    }, 3600000); // Every hour (3600000 ms)

    // Process pending transactions
    const processPendingTransactions = async () => {
        try {
            // console.log('Fetching pending transactions...');
            /*const pendingTxCount = await jsonRpcClient.getPendingTxCount();
            if (pendingTxCount === 0) {
                // console.log('No pending transactions found.');
                return;
            }*/
            const pendingTransactions = await retryAsync(() => jsonRpcClient.getPendingTxs());
            // console.log(`Found ${pendingTransactions.length} pending transactions.`);

            // Drop all existing pending transactions before inserting the new batch
            
            // console.log('Cleared existing pending transactions.');

            const newPendingTxDocs = [];
            for (const tx of pendingTransactions) {
                try {
                    const txHash = (await tx.getTxHash()).toString();
                    newPendingTxDocs.push({
                        txHash: txHash,
                        data: tx.data.toBuffer().toString('hex'), // Serialize to hex string
                        clientIvcProof: tx.clientIvcProof.toBuffer().toString('hex'), // Serialize to hex string
                        contractClassLogs: tx.contractClassLogs.map(log => log.toBuffer().toString('hex')),
                        publicFunctionCalldata: tx.publicFunctionCalldata.map(data => data.toBuffer().toString('hex')),
                        timestamp: new Date(),
                    });
                } catch (e) {
                    console.error('Error preparing pending transaction for save: ', e instanceof Error ? e.message : String(e));
                }
            }

            await PendingTransaction.deleteMany({});
            if (newPendingTxDocs.length > 0) {
                await PendingTransaction.insertMany(newPendingTxDocs);
                // console.log(`Inserted ${newPendingTxDocs.length} new pending transactions.`);
            }

        } catch (error) {
            console.error('Error fetching pending transactions: ', error instanceof Error ? error.message : String(error));
        }
    };

    // Schedule regular checks for pending transactions
    setInterval(processPendingTransactions, 10000);
}


async function listenForNewBlocks2(blockNum: number, blocks: L2Block[], logger: Logger) {
    const jsonRpcClient = createAztecNodeClient(PXE_URL);
    let currentBlockNum = blockNum;
    const BATCH_SIZE = 50; // Number of blocks to fetch at once when behind

    async function fetchBlocks() {
        let blocksBehind = 0;
        try {
            const latestBlock = await retryAsync(() => jsonRpcClient.getBlockNumber());
            blocksBehind = latestBlock - currentBlockNum;
            
            logger.info(format('Latest block: ', latestBlock, ' Current block: ', currentBlockNum, ' Behind by: ', blocksBehind));
            
            // If we're significantly behind, use batch fetching with getBlocks
            if (blocksBehind > BATCH_SIZE) {
                console.log(`Syncing in batch mode - ${blocksBehind} blocks behind`);
                
                // Calculate how many blocks to fetch (up to BATCH_SIZE)
                const batchSize = Math.min(BATCH_SIZE, blocksBehind);
                
                // Fetch multiple blocks at once
                const fetchedBlocks = await retryAsync(() => jsonRpcClient.getBlocks(currentBlockNum, batchSize));
                
                if (fetchedBlocks && fetchedBlocks.length > 0) {
                    // Add all fetched blocks to our queue
                    fetchedBlocks.forEach(block => blocks.push(block));
                    
                    // Update our position to after the last block received
                    if (fetchedBlocks.length > 0) {
                        const lastBlock = fetchedBlocks[fetchedBlocks.length - 1];
                        const lastBlockNum = lastBlock.header.globalVariables.blockNumber.toNumber();
                        currentBlockNum = lastBlockNum + 1;
                        console.log(`Batch sync progress: Fetched blocks ${fetchedBlocks[0].header.globalVariables.blockNumber.toNumber()}-${lastBlockNum}`);
                    }
                }
            } 
            // Otherwise use individual block fetching for normal operation
            else {
                while (currentBlockNum <= latestBlock) {
                    const block = await retryAsync(() => jsonRpcClient.getBlock(currentBlockNum));
                    if (block) {
                        blocks.push(block);
                        currentBlockNum++;
                    } else {
                        // Break if a block isn't found to avoid getting stuck
                        console.log(`Block ${currentBlockNum} not found, skipping...`);
                        currentBlockNum++;
                    }
                }
            }
        } catch (error) {
            logger.info(format('Error getting blocks: ', error));
        } finally {
            // Adjust polling interval based on how far behind we are
            const pollInterval = blocksBehind > 100 ? 10 : 1000; // Poll faster if we're far behind
            setTimeout(fetchBlocks, pollInterval);
        }
    }

    fetchBlocks();
}

async function listenForNewBlocksPXE(blockNum: number, blocks: L2Block[], logger: Logger) {
    const pxe = createPXEClient(PXE_URL);
    let currentBlockNum = blockNum;
    const BATCH_SIZE = 50; // Number of blocks to fetch at once when behind

    async function fetchBlocks() {
        let blocksBehind = 0;
        try {
            const latestBlock = await pxe.getBlockNumber();
            blocksBehind = latestBlock - currentBlockNum;
            
            logger.info(format('Latest block: ', latestBlock, ' Current block: ', currentBlockNum, ' Behind by: ', blocksBehind));
                        
            while (currentBlockNum <= latestBlock) {
                const block = await pxe.getBlock(currentBlockNum);
                if (block) {
                    blocks.push(block);
                    currentBlockNum++;
                } else {
                    // Break if a block isn't found to avoid getting stuck
                    console.log(`Block ${currentBlockNum} not found, skipping...`);
                    currentBlockNum++;
                }
            }
            
        } catch (error) {
            logger.info(format('Error getting blocks: ', error));
        } finally {
            // Adjust polling interval based on how far behind we are
            const pollInterval = blocksBehind > 100 ? 10 : 1000; // Poll faster if we're far behind
            setTimeout(fetchBlocks, pollInterval);
        }
    }

    fetchBlocks();
}

main();