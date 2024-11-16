import { getDeployedTestAccountsWallets, getInitialTestAccountsWallets } from '@aztec/accounts/testing';
import {
  createDebugLogger,
  createPXEClient,
  waitForPXE,
  L2Block,
  DebugLogger,
  Wallet,
  AccountWalletWithSecretKey,
  AztecAddress,
  createAztecNodeClient,
  FunctionArtifact,
} from '@aztec/aztec.js';

import {
    TxEffect,
    ExtendedNote,
    TxHash
  } from '@aztec/circuit-types';
import { format } from 'util';
import { connectDB } from './utils/db.js';
import Transaction  from './models/transaction.model.js';
import Block  from './models/block.model.js';
import Note from './models/note.model.js';
import Account from './models/account.model.js';
import { ZERO_ADDRESS } from './consts/consts.js';
import { FunctionAbi } from './interfaces/aztec.interfaces.js';


const { PXE_URL = 'http://188.40.109.171:8080' } = process.env;

async function main() {
    const logger = createDebugLogger('token');
    const pxe = createPXEClient(PXE_URL);
    const jsonRpcClient = createAztecNodeClient(PXE_URL);
    logger.debug('Waiting for PXE');
    await waitForPXE(pxe, logger);
    logger.info('PXE is ready');
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

    
    const registeredAccounts = await pxe.getRegisteredAccounts();
    registeredAccounts.forEach(async (account) => {
        addresses.push(account.address);
    });
    const contracts = await pxe.getContracts();
    contracts.forEach(async (contract) => {addresses.push(contract)});


    //Block Listener
    listenForNewBlocks2(blockNum, blocksArray,logger);
    setInterval(() => {
        //console.log('Blocks Array Length: ', blocksArray.length);
        if(blocksArray.length > 0) {
            const block = blocksArray.shift();
            if (block) {
                console.log('Got Block: ', block.header.globalVariables.blockNumber.toNumber());
                const tsDate = new Date(block.header.globalVariables.timestamp.toNumber()*1000);
                const L2Block = new Block({
                    hash: block.hash().toString(),
                    number: block.header.globalVariables.blockNumber.toNumber(),
                    timestamp: tsDate,
                    coinbaseAccount: block.header.globalVariables.coinbase,
                    totalFees: block.header.totalFees.toNumber(),
                    feeRecipient: block.header.globalVariables.feeRecipient,
                    txCount: block.body.txEffects.length,
                    paddingTxCount: block.body.numberOfTxsIncludingPadded - block.body.txEffects.length,
                    size: block.header.getSize(),
                    feePerDaGas: block.header.globalVariables.gasFees.feePerDaGas.toNumber(),
                    feePerL2Gas: block.header.globalVariables.gasFees.feePerL2Gas.toNumber(),
                });

                // Ensure _id is not in L2Block
                const { _id, ...L2BlockWithoutId } = L2Block.toObject(); 

                BlockTxEffects.push({txEffect: block.body.txEffects, blockNumber: block.header.globalVariables.blockNumber.toNumber(), timestamp: tsDate});
                //console.log('TX Effects pushed. Length: ', txEffectsArray.length);
                Block.findOneAndUpdate({number: block.header.globalVariables.blockNumber.toNumber()}, L2BlockWithoutId, {upsert: true}).catch((error) => {
                    console.error('Error upserting block: ', error.message);
                });
            }
        }
    }, 1000);


    //TX Listener
    setInterval(async () => {
        if(BlockTxEffects.length > 0) {
            const blockTxEffect = BlockTxEffects.shift();
            if (blockTxEffect) {
                for (let i = 0; i < blockTxEffect.txEffect.length; i++) {
                    const txEffect = blockTxEffect.txEffect[i];
                    const unencryptedLogs = txEffect.unencryptedLogs
                    const noteHashes = txEffect.noteHashes;
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
                        unencryptedLogsLength: txEffect.unencryptedLogs.functionLogs.length,
                        uneencryptedLogs: JSON.stringify(unencryptedLogs.toJSON()),
                    });
                    const { _id, ...TxEffectWithoutId } = TxEffect.toObject();
                    txHashes.push(txEffect.txHash);
                    unencryptedLogs.unrollLogs().forEach((log) => {
                        addresses.push(log.contractAddress);
                    });

                    noteHashes.forEach((noteHash) => {
                        addresses.push(new AztecAddress(Buffer.from(noteHash.toBuffer())));
                    })

                    Transaction.findOneAndUpdate({hash: '0x'+txEffect.txHash.toString()}, TxEffectWithoutId, {upsert: true}).catch((error) => {
                        console.error('Error updating transaction: ', error.message);
                    });
                }
            }
        }
    }, 1000);


    //note listener
    setInterval(async () => {
        if(txHashes.length > 0) {
            const txHash = txHashes.shift();
            const incomingNotes = await pxe.getIncomingNotes({txHash: txHash});
            incomingNotes.forEach(async (incomingNote) => {
                const note = new Note({
                    note: incomingNote.note.toBuffer().toString('hex'),
                    txHash: '0x'+incomingNote.txHash.toString(),
                    owner: incomingNote.owner.toString(),
                    contractAddress: incomingNote.contractAddress.toString(),
                    storageSlot: incomingNote.storageSlot.toString(),
                    noteType: incomingNote.noteTypeId.toString()
                });
                const { _id, ...noteWithoutId } = note.toObject();
                addresses.push(incomingNote.owner, incomingNote.contractAddress);
                Note.findOneAndUpdate({note: incomingNote.note.toBuffer().toString('hex'), txHash: incomingNote.txHash.toString()}, noteWithoutId, {upsert: true}).catch((error) => {
                    console.error('Error upserting note: ', error.message);
                });
            });
            const outgoingNotes = await pxe.getOutgoingNotes({txHash: txHash});
            outgoingNotes.forEach(async (outgoingNote) => {
                const note = new Note({
                    note: outgoingNote.note.toBuffer().toString('hex'),
                    txHash: '0x'+outgoingNote.txHash.toString(),
                    owner: outgoingNote.owner.toString(),
                    contractAddress: outgoingNote.contractAddress.toString(),
                    storageSlot: outgoingNote.storageSlot.toString(),
                    noteType: outgoingNote.noteTypeId.toString()
                });
                const { _id, ...noteWithoutId } = note.toObject();
                addresses.push(outgoingNote.owner, outgoingNote.contractAddress);
                Note.findOneAndUpdate({note: outgoingNote.note.toBuffer().toString('hex'), txHash: outgoingNote.txHash.toString()}, noteWithoutId, {upsert: true}).catch((error) => {
                    console.error('Error upserting note: ', error.message);
                });
            });
        }
    },1000);

    //Account Listener
    setInterval(async () => {
        if(addresses.length > 0) {
            const address = addresses.shift();
            //console.log(address?.toString());
            if(address) {
                const contract = await pxe.getContractInstance(address);
                if (contract) {
                    let isContract = true;
                    if(contract.deployer.toString() === ZERO_ADDRESS) {
                        isContract = false;
                    }
                    let functions: FunctionAbi[] = [];
                    let name = '';
                    const artifact = await pxe.getContractArtifact(contract.contractClassId)
                    if (artifact) {
                        name = artifact.name;
                        artifact.functions.forEach((functionAbi) => {
                            functions.push({
                                name: functionAbi.name,
                                functionType: functionAbi.functionType,
                                isInternal: functionAbi.isInternal,
                                isStatic: functionAbi.isStatic,
                                parameters: functionAbi.parameters,
                                returnTypes: functionAbi.returnTypes,
                                isInitializer: functionAbi.isInitializer,
                            });
                        });
                    }
                    let byteCode = '';
                    const contClass = await pxe.getContractClass(contract.contractClassId);
                    if (contClass) {
                        byteCode = contClass.packedBytecode.toString();
                    }


                    const account = new Account({
                        address: address.toString(),
                        version: contract.version,
                        deployer: contract.deployer.toString(),
                        contractClassID: contract.contractClassId.toString(),
                        isContract: true,
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
            }
        }
    }, 1000);
}


async function listenForNewBlocks2(blockNum: number, blocks: L2Block[], logger: DebugLogger) {
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
            setTimeout(fetchBlocks, 500);
        }
    }

    fetchBlocks();
}

main();