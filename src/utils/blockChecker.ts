import { createAztecNodeClient } from '@aztec/aztec.js';
import Block, { IBlock } from '../models/block.model.js';
import Transaction, { ITransaction } from '../models/transaction.model.js';
import { connectDB } from './db.js';
import { FinalityStatus } from './finality.js';

// Define types for chain tip information
interface ChainTip {
  number: number;
  hash: string;
}

interface L2Tips {
  latest: ChainTip;
  proven: ChainTip;
  finalized: ChainTip;
}

/**
 * Class to handle block status checking and reorg detection
 */
export class BlockChecker {
  private nodeClient: any;
  private previousFinalized: ChainTip | null = null;
  private lastCheckTime: number = 0;
  private reorgModel: any;
  private isInitialSync: boolean = true;

  constructor(private pxeUrl: string, reorgModel: any) {
    this.nodeClient = createAztecNodeClient(pxeUrl);
    this.reorgModel = reorgModel;
  }

  /**
   * Initialize by getting the last finalized block we know about
   */
  async initialize() {
    try {
      await connectDB();
      
      // Get current chain tips to understand the blockchain state
      const tips = await this.getL2Tips();
      console.log(`Chain tips - Latest: ${tips.latest.number}, Proven: ${tips.proven.number}, Finalized: ${tips.finalized.number}`);
      
      // Get the last known finalized block from our database
      const lastFinalizedBlock = await Block.findOne({ 
        finalityStatus: FinalityStatus.FINALIZED 
      }).sort({ number: -1 }).limit(1);
      
      if (lastFinalizedBlock) {
        this.previousFinalized = {
          number: lastFinalizedBlock.number,
          hash: lastFinalizedBlock.hash
        };
        console.log(`Initialized with last finalized block: ${this.previousFinalized.number}`);
        
        // Check if we're significantly behind chain head
        const blocksBehind = tips.finalized.number - lastFinalizedBlock.number;
        if (blocksBehind > 100) {
          console.log(`Database is ${blocksBehind} blocks behind the finalized chain head.`);
          console.log('Performing initial mass update of finality statuses...');
          
          this.isInitialSync = true;
          await this.performInitialSync(tips);
        } else {
          this.isInitialSync = false;
        }
      } else {
        console.log('No finalized blocks found in database. Starting fresh.');
        this.isInitialSync = true;
        
        // Update all existing blocks with initial statuses
        console.log('Setting initial finality status for all blocks...');
        await this.performInitialSync(tips);
      }
      
      this.lastCheckTime = Date.now();
    } catch (error) {
      console.error('Error initializing BlockChecker:', error);
      throw error;
    }
  }

  /**
   * Perform an initial sync of finality statuses for a large number of blocks
   */
  private async performInitialSync(tips: L2Tips) {
    try {
      console.log('Performing bulk update of finality statuses for existing blocks...');
      
      // Update finality statuses in bulk operations
      await Block.updateMany(
        { number: { $gt: tips.proven.number } },
        { $set: { finalityStatus: FinalityStatus.PRECONFIRMED } }
      );
      
      await Block.updateMany(
        { number: { $gt: tips.finalized.number, $lte: tips.proven.number } },
        { $set: { finalityStatus: FinalityStatus.PROVEN } }
      );
      
      await Block.updateMany(
        { number: { $lte: tips.finalized.number } },
        { $set: { finalityStatus: FinalityStatus.FINALIZED } }
      );
      
      // Bulk update transactions in batches to avoid memory issues
      const BATCH_SIZE = 1000;
      let processedBlocks = 0;
      let lastProcessedBlock = 0;
      
      // Find highest block we have to process
      const highestBlock = await Block.findOne({}).sort({ number: -1 }).limit(1);
      const highestBlockNumber = highestBlock ? highestBlock.number : 0;
      
      while (lastProcessedBlock < highestBlockNumber) {
        // Get a batch of blocks
        const blockBatch = await Block.find({ 
          number: { $gt: lastProcessedBlock, $lte: lastProcessedBlock + BATCH_SIZE } 
        }, { number: 1, finalityStatus: 1 })
        .sort({ number: 1 });
        
        if (blockBatch.length === 0) break;
        
        // Process each block in the batch
        for (const block of blockBatch) {
          const blockData = block.toObject();
          await Transaction.updateMany(
            { blockNumber: blockData.number },
            { $set: { finalityStatus: blockData.finalityStatus } }
          );
          lastProcessedBlock = blockData.number;
        }
        
        processedBlocks += blockBatch.length;
        console.log(`Initial sync progress: Processed ${processedBlocks} blocks...`);
      }
      
      console.log('Initial sync of finality statuses completed.');
      
      // Set our previous finalized reference point
      this.previousFinalized = {
        number: tips.finalized.number,
        hash: tips.finalized.hash
      };
      
      this.isInitialSync = false;
    } catch (error) {
      console.error('Error during initial sync:', error);
      throw error;
    }
  }

  /**
   * Get the latest chain tips from the node
   */
  async getL2Tips(): Promise<L2Tips> {
    try {
      // Call the node to get chain tips
      const tips = await this.nodeClient.getL2Tips();
      return tips;
    } catch (error) {
      console.error('Error getting L2 tips:', error);
      throw error;
    }
  }

  /**
   * Check and update block finality status
   */
  async checkAndUpdateStatus() {
    try {
      // Skip if we're still in initial sync mode
      if (this.isInitialSync) {
        console.log('Initial sync still in progress, skipping regular status check.');
        return;
      }
      
      console.log('Checking for updates to block finality status...');
      
      // Get current chain tips
      const tips = await this.getL2Tips();
      console.log(`Chain tips - Latest: ${tips.latest.number}, Proven: ${tips.proven.number}, Finalized: ${tips.finalized.number}`);
      
      // Update block statuses
      await this.updateBlockStatuses(tips);
      
      // Check for reorgs if we had a previous finalized block
      if (this.previousFinalized && 
          this.previousFinalized.number < tips.finalized.number) {
        await this.checkForReorgs(this.previousFinalized, tips.finalized);
      }
      
      // Update our reference to current finalized block
      this.previousFinalized = {
        number: tips.finalized.number,
        hash: tips.finalized.hash
      };
      
      this.lastCheckTime = Date.now();
      console.log('Finality status check completed');
    } catch (error) {
      console.error('Error checking block status:', error);
    }
  }

  /**
   * Update the finality status of blocks
   */
  private async updateBlockStatuses(tips: L2Tips) {
    try {
      // Update preconfirmed blocks (anything higher than the proven block)
      await Block.updateMany(
        { number: { $gt: tips.proven.number } },
        { $set: { finalityStatus: FinalityStatus.PRECONFIRMED } }
      );
      
      // Update proven blocks (between finalized and proven)
      await Block.updateMany(
        { number: { $gt: tips.finalized.number, $lte: tips.proven.number } },
        { $set: { finalityStatus: FinalityStatus.PROVEN } }
      );
      
      // Update finalized blocks
      await Block.updateMany(
        { number: { $lte: tips.finalized.number } },
        { $set: { finalityStatus: FinalityStatus.FINALIZED } }
      );
      
      // Get blocks that were just updated and update their transactions
      const recentlyUpdatedBlocks = await Block.find({ 
        $or: [
          { number: { $gt: tips.finalized.number - 10 } }, // Recently finalized
          { number: { $gt: tips.proven.number - 10 } }     // Recently proven
        ]
      }, { number: 1, finalityStatus: 1 });
      
      // Update transaction status based on their block's finality
      // Only for recent blocks to avoid expensive operations every check
      for (const block of recentlyUpdatedBlocks) {
        const blockData = block.toObject();
        await Transaction.updateMany(
          { blockNumber: blockData.number },
          { $set: { finalityStatus: blockData.finalityStatus } }
        );
      }
    } catch (error) {
      console.error('Error updating block statuses:', error);
      throw error;
    }
  }

  /**
   * Check for reorgs by comparing the chain between previous and current finalized blocks
   */
  private async checkForReorgs(prevFinalized: ChainTip, currentFinalized: ChainTip) {
    try {
      console.log(`Checking for reorgs between blocks ${prevFinalized.number} and ${currentFinalized.number}`);
      
      // Get all blocks in this range from our DB
      const ourBlocks = await Block.find({
        number: { $gt: prevFinalized.number, $lte: currentFinalized.number }
      }).sort({ number: 1 });
      
      const reorgedBlocks = [];
      
      // Check each block against the node to see if it's been reorged out
      for (const block of ourBlocks) {
        const nodeBlock = await this.nodeClient.getBlock(block.number);
        
        // If the node's block at this height has a different hash, it's been reorged
        if (nodeBlock && (await nodeBlock.hash()).toString() !== block.hash) {
          console.log(`Detected reorg: Block ${block.number} has different hash`);
          console.log(`Our hash: ${block.hash}`);
          console.log(`Node hash: ${(await nodeBlock.hash()).toString()}`);
          
          reorgedBlocks.push(block);
        }
      }
      
      if (reorgedBlocks.length > 0) {
        await this.handleReorganization(reorgedBlocks);
      } else {
        console.log('No reorgs detected');
      }
    } catch (error) {
      console.error('Error checking for reorgs:', error);
    }
  }

  /**
   * Handle a detected blockchain reorganization
   */
  private async handleReorganization(reorgedBlocks: any[]) {
    try {
      // Sort blocks by number for cleaner processing
      reorgedBlocks.sort((a, b) => a.number - b.number);
      
      // Get all transactions in these blocks
      const reorgedBlockNumbers = reorgedBlocks.map(block => block.number);
      const affectedTxs = await Transaction.find({
        blockNumber: { $in: reorgedBlockNumbers }
      });
      
      console.log(`Handling reorg of ${reorgedBlocks.length} blocks with ${affectedTxs.length} transactions`);
      
      // Mark blocks as reorged
      for (const block of reorgedBlocks) {
        await Block.updateOne(
          { number: block.number, hash: block.hash },
          { $set: { finalityStatus: FinalityStatus.REORGED } }
        );
      }
      
      // Mark transactions as reorged
      for (const tx of affectedTxs) {
        await Transaction.updateOne(
          { hash: tx.hash },
          { $set: { finalityStatus: FinalityStatus.REORGED } }
        );
      }
      
      // Record this reorg event
      const reorgEntry = new this.reorgModel({
        timestamp: new Date(),
        startBlock: reorgedBlocks[0].number,
        endBlock: reorgedBlocks[reorgedBlocks.length - 1].number,
        length: reorgedBlocks.length,
        affectedTxCount: affectedTxs.length,
        blocks: reorgedBlocks.map(block => ({
          number: block.number,
          hash: block.hash
        }))
      });
      
      await reorgEntry.save();
      console.log(`Reorg event recorded with ID: ${reorgEntry._id}`);
      
      // You could also delete these blocks/txs or handle differently if preferred
      // Rather than deleting, we've marked them with REORGED status
    } catch (error) {
      console.error('Error handling reorganization:', error);
    }
  }
}

export default BlockChecker; 