import { getDeployedTestAccountsWallets, getInitialTestAccountsWallets } from '@aztec/accounts/testing';
import {
  createDebugLogger,
  createPXEClient,
  waitForPXE,
  L2Block,
  DebugLogger,
  Wallet
} from '@aztec/aztec.js';

import {
    TxEffect,
  } from '@aztec/circuit-types';
import { format } from 'util';
import { connectDB } from './utils/db.js';
import Transaction  from './models/transaction.model.js';
import Block  from './models/block.model.js';
import { TokenContract } from '@aztec/noir-contracts.js/Token';

const { PXE_URL = 'http://188.40.109.171:8088' } = process.env;

async function main() {
    const logger = createDebugLogger('token');
    logger.info('Starting token example');
    // We create PXE client connected to the sandbox URL
    const pxe = createPXEClient(PXE_URL);
    // Wait for sandbox to be ready
    logger.debug('Waiting for PXE');
    await waitForPXE(pxe, logger);
    const info = await pxe.getNodeInfo()
    console.log(info)
    logger.info('PXE is ready');
    const initialSupply = 1_000_000n;
    connectDB();
    const blockNum = 0;

    let blocksArray: L2Block[] = [];
    type BlockTxEffect = {
        txEffect: TxEffect[];
        blockNumber: number;
    };
    let BlockTxEffects: BlockTxEffect[] = [];
    listenForNewBlocks2(blockNum, blocksArray,logger);
    setInterval(() => {
        //console.log('Blocks Array Length: ', blocksArray.length);
        if(blocksArray.length > 0) {
            const block = blocksArray.shift();
            if (block) {
                console.log('Got Block: ', block.header.globalVariables.blockNumber.toNumber());
                const L2Block = new Block({
                    hash: block.hash().toString(),
                    number: block.header.globalVariables.blockNumber.toNumber(),
                    timestamp: new Date(),
                    coinbaseAccount: block.header.globalVariables.coinbase,
                    totalFees: block.header.totalFees.toNumber(),
                    feeRecipient: block.header.globalVariables.feeRecipient,
                    txCount: block.body.txEffects.length,
                    paddingTxCount: block.body.numberOfTxsIncludingPadded - block.body.txEffects.length,
                });
                // Ensure _id is not in L2Block
                const { _id, ...L2BlockWithoutId } = L2Block.toObject(); 

                BlockTxEffects.push({txEffect: block.body.txEffects, blockNumber: block.header.globalVariables.blockNumber.toNumber()});
                //console.log('TX Effects pushed. Length: ', txEffectsArray.length);
                Block.findOneAndUpdate({number: block.header.globalVariables.blockNumber.toNumber()}, L2BlockWithoutId, {upsert: true}).catch((error) => {
                    console.error('Error upserting block: ', error.message);
                });
            }
        }
    }, 1000);

    setInterval(async () => {
        if(BlockTxEffects.length > 0) {
            const blockTxEffect = BlockTxEffects.shift();
            if (blockTxEffect) {
                for (let i = 0; i < blockTxEffect.txEffect.length; i++) {
                    const txEffect = blockTxEffect.txEffect[i];
                    const TxEffect = new Transaction({
                        hash: txEffect.txHash.toString(),
                        index: i,
                        blockNumber: blockTxEffect.blockNumber,
                        //revertCode: txEffect.revertCode,
                        transactionFee: txEffect.transactionFee.toNumber(),
                        noteHashes: txEffect.noteHashes.toString(),
                        nullifiers: txEffect.nullifiers.toString(),
                        l2ToL1Msgs: txEffect.l2ToL1Msgs.toString(),
                        publicDataWrites: txEffect.publicDataWrites.toString(),
                        unencryptedLogsLength: txEffect.unencryptedLogs.functionLogs.length,
                        uneencryptedLogs: JSON.stringify(txEffect.unencryptedLogs.toJSON()),
                    });
                    const { _id, ...TxEffectWithoutId } = TxEffect.toObject();
                    Transaction.findOneAndUpdate({hash: txEffect.txHash.toString()}, TxEffectWithoutId, {upsert: true}).catch((error) => {
                        console.error('Error updating transaction: ', error.message);
                    });
                }
            }
        }
    }, 1000);
}

async function listenForNewBlocks(blockNum: number, blocks: L2Block[], logger: DebugLogger) {
    const pxe = createPXEClient(PXE_URL);
    let currentBlockNum = blockNum;
    setInterval(async () => {
        try {
            const latestBlock = await pxe.getBlockNumber();
            logger.info(format('Latest block: ', latestBlock, ' Current block: ', currentBlockNum));
            while (currentBlockNum <= latestBlock) {
                //logger.info(format('Getting block: ', currentBlockNum));
                const block = await pxe.getBlock(currentBlockNum);
                if (block) {
                    //console.log('Got Block: ', currentBlockNum);
                    blocks.push(block);
                    currentBlockNum++;
                }
            }
        } catch (error) {
            logger.info(format('Error getting block: ', error));
        }
    }, 500);
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