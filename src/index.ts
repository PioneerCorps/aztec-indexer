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
import Account from './models/account.model.js';
import { ZERO_ADDRESS } from './consts/consts.js';
import { FunctionAbi, FunctionType } from './interfaces/aztec.interfaces.js';


const { PXE_URL = 'http://localhost:8080' } = process.env;


async function main() {
    console.log('Starting Aztec Explorer');
    const logger = createLogger('token');
    console.log(PXE_URL)
    const pxe = createPXEClient(PXE_URL);
    const jsonRpcClient = createAztecNodeClient(PXE_URL);
    logger.debug('Waiting for PXE');
    console.log('Waiting for PXE');
    await waitForPXE(pxe, logger);
    logger.debug('PXE is ready');
    connectDB();
    const blockNum = 1;

    let blocksArray: L2Block[] = [];
    type BlockTxEffect = {
        txEffect: TxEffect[];
        blockNumber: number;
        timestamp: Date;
    };
    let BlockTxEffects: BlockTxEffect[] = [];
    let txHashes: TxHash[] = [];
    let addresses: AztecAddress[] = [];

    //const registeredAccounts = await pxe.getRegisteredAccounts();
    //registeredAccounts.forEach(async (account) => {
    //    addresses.push(account.address);
    //});
    //const contracts = await pxe.getContracts();
    //contracts.forEach(async (contract) => {addresses.push(contract)});
    console.log(await pxe.getNodeInfo())


    //Block Listener
    listenForNewBlocks2(blockNum, blocksArray,logger);
    setInterval(async () => {
        if(blocksArray.length > 0) {
            const block = blocksArray.shift();
            if (block) {
                console.log('Got Block: ', block.header.globalVariables.blockNumber.toNumber());
                const tsDate = new Date(block.header.globalVariables.timestamp.toNumber()*1000);
                const L2Block = new Block({
                    hash: (await block.hash()).toString(),
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

                // Ensure _id is not in L2Block
                const { _id, ...L2BlockWithoutId } = L2Block.toObject(); 

                BlockTxEffects.push({txEffect: block.body.txEffects, blockNumber: block.header.globalVariables.blockNumber.toNumber(), timestamp: tsDate});
                Block.findOneAndUpdate({number: block.header.globalVariables.blockNumber.toNumber()}, L2BlockWithoutId, {upsert: true}).catch((error) => {
                    console.error('Error upserting block: ', error.message);
                });
            }
        }
    }, 300);


    //TX Listener
    setInterval(async () => {
        if(BlockTxEffects.length > 0) {
            const blockTxEffect = BlockTxEffects.shift();
            if (blockTxEffect) {
                for (let i = 0; i < blockTxEffect.txEffect.length; i++) {
                    const txEffect = blockTxEffect.txEffect[i];
                    const noteHashes = txEffect.noteHashes;
                    const privateLogs = txEffect.privateLogs.map((log) => {
                        return log.toBuffer().toString('hex');
                    });

                    txEffect.privateLogs.forEach((log) => {
                        const chunkSize = 32;
                        const logBuffer = log.toBuffer();
                        for (let i = 0; i < logBuffer.length; i += chunkSize) {
                            addresses.push(new AztecAddress(logBuffer.subarray(i,i+32)));
                        }
                    });

                    const TxEffect = new Transaction({
                        hash: '0x'+txEffect.txHash.toString(),
                        index: i,
                        blockNumber: blockTxEffect.blockNumber,
                        timestamp: blockTxEffect.timestamp,
                        revertCode: txEffect.revertCode.getDescription(),
                        transactionFee: txEffect.transactionFee.toNumber(),
                        noteHashes: noteHashes.toString(),
                        nullifiers: txEffect.nullifiers.toString(),
                        l2ToL1Msgs: txEffect.l2ToL1Msgs.toString(),
                        publicDataWrites: txEffect.publicDataWrites.toString(),
                        unencryptedLogsLength: txEffect.publicLogs.length,
                        uneencryptedLogs: txEffect.publicLogs.toString(),
                        encryptedLogs: privateLogs.join(','),
                    });
                    const { _id, ...TxEffectWithoutId } = TxEffect.toObject();
                    txHashes.push(txEffect.txHash);
                    
                    Transaction.findOneAndUpdate({hash: '0x'+txEffect.txHash.toString()}, TxEffectWithoutId, {upsert: true}).catch((error) => {
                        console.error('Error updating transaction: ', error.message);
                    });
                }
            }
        }
    }, 300);


    //note listener
    setInterval(async () => {
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
    },300);

    //Account Listener
    setInterval(async () => {
        if(addresses.length > 0) {
            const address = addresses.shift();
            if(address) {
                /*
                const contract = await jsonRpcClient.getContract(address);
                if (contract) {
                    const contractClass = await jsonRpcClient.getContractClass(contract.currentContractClassId);
                    let byteCode: Buffer = Buffer.from('');
                    if (contractClass) {
                        contractClass.publicFunctions.forEach((functionAbi) => {
                            
                        });
                        contractClass.privateFunctions.forEach((functionAbi) => {
                        });
                        byteCode = contractClass.packedBytecode;
                    }

                    let isContract = true;
                    if(contract.deployer.toString() === ZERO_ADDRESS) {
                        isContract = false;
                    }
                    
                    
                    const functions: FunctionAbi[] = [];
                    const name = contractClass || '';
                    const account = new Account({
                        address: address.toString(),
                        version: contract.version,
                        deployer: contract.deployer.toString(),
                        contractClassID: contract.currentContractClassId.toString(),
                        isContract: isContract,
                        balance: BigInt(0).toString(),
                        functions: functions,
                        byteCode: byteCode,
                        name: name,
                    });
                    const { _id, ...accountWithoutId } = account.toObject();
                    Account.findOneAndUpdate({address: address.toString()}, accountWithoutId, {upsert: true}).catch((error) => {
                        console.error('Error upserting account: ', error.message);
                    });
                }
                    */
                const contractMetadata = await pxe.getContractMetadata(address);
                console.log("getting contract for address: ",address.toString())
                if (contractMetadata.isContractInitialized || contractMetadata.isContractPubliclyDeployed) {
                    console.log("got contract for address: ",address.toString())
                    let isContract = true;
                    let name = '';
                    let functions: FunctionAbi[] = [];
                    let byteCode : Buffer = Buffer.from('');
                    if(contractMetadata.contractInstance?.currentContractClassId) {
                        const contractClassMetadata = await pxe.getContractClassMetadata(contractMetadata.contractInstance?.currentContractClassId,true);
                        if (contractClassMetadata){
                            name = contractClassMetadata.artifact?.name || '';
                            contractClassMetadata.artifact?.functions.forEach((functionAbi) => {
                                functions.push({
                                    name: functionAbi.name,
                                    functionType: functionAbi.functionType,
                                    isInternal: functionAbi.isInternal,
                                    isStatic: functionAbi.isStatic,
                                    parameters: functionAbi.parameters,
                                    returnTypes: functionAbi.returnTypes,
                                    isInitializer: functionAbi.isInitializer,
                                });
                            })
                            if(contractClassMetadata.contractClass?.packedBytecode){
                                byteCode = contractClassMetadata.contractClass?.packedBytecode;
                            }
                        }
                    }
                    
                    if(contractMetadata.contractInstance?.deployer.toString() === ZERO_ADDRESS) {
                        isContract = false;
                    }

                    
                    
                    const account = new Account({
                        address: address.toString(),
                        version: contractMetadata.contractInstance?.version,
                        deployer: contractMetadata.contractInstance?.deployer.toString(),
                        contractClassID: contractMetadata.contractInstance?.currentContractClassId.toString(),
                        isContract: isContract,
                        balance: BigInt(0).toString(),
                        functions: functions,
                        byteCode: byteCode.toString('hex'),
                        name: name,
                    });
                    const { _id, ...accountWithoutId } = account.toObject();
                    Account.findOneAndUpdate({address: address.toString()}, accountWithoutId, {upsert: true}).catch((error) => {
                        console.error('Error upserting account: ', error.message);
                    });
                }
            }
        }
    }, 300);
}


async function listenForNewBlocks2(blockNum: number, blocks: L2Block[], logger: Logger) {
    const pxe = createPXEClient(PXE_URL);
    let currentBlockNum = blockNum;

    async function fetchBlocks() {
        try {
            const latestBlock = await pxe.getBlockNumber();
            logger.info(format('Latest block: ', latestBlock, ' Current block: ', currentBlockNum));
            while (currentBlockNum <= latestBlock) {
                const block = await pxe.getBlock(currentBlockNum);
                if (block) {
                    blocks.push(block);
                    currentBlockNum++;
                }
            }
        } catch (error) {
            logger.info(format('Error getting block: ', error));
        } finally {
            setTimeout(fetchBlocks, 100);
        }
    }

    fetchBlocks();
}

main();