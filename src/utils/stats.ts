import Stats from '../models/stats.model.js';
import Transaction from '../models/transaction.model.js';
import Block from '../models/block.model.js';
import { ContractClass } from '../models/contractClass.model.js';
import { Account } from '../models/account.model.js';

/**
 * Updates daily statistics for transactions and blocks
 */
export const updateDailyStats = async (): Promise<void> => {
  try {
    // Get today's date (start of day)
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    // Get tomorrow's date for query range
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);
    
    // Count transactions and blocks for today
    const txCount = await Transaction.countDocuments({
      timestamp: { $gte: today, $lt: tomorrow }
    });
    
    const blockCount = await Block.countDocuments({
      timestamp: { $gte: today, $lt: tomorrow }
    });

    const contractClassCount = await ContractClass.countDocuments({
      creationTimestamp: { $gte: today, $lt: tomorrow }
    });

    const accountCount = await Account.countDocuments({
      creationTimestamp: { $gte: today, $lt: tomorrow }
    });
    
    // Calculate avg tx fee
    let avgTxFee = 0;
    if (txCount > 0) {
      const txs = await Transaction.find(
        { timestamp: { $gte: today, $lt: tomorrow } },
        { transactionFee: 1, _id: 0 }
      );
      
      const totalFees = txs.reduce((sum, tx) => sum + (tx.transactionFee || 0), 0);
      avgTxFee = totalFees / txs.length;
    }
    
    // Calculate average block time
    let avgBlockTime = 0;
    if (blockCount > 1) {
      // Get all blocks for the day sorted by timestamp
      const blocks = await Block.find(
        { timestamp: { $gte: today, $lt: tomorrow } },
        { timestamp: 1, _id: 0 }
      ).sort({ timestamp: 1 });
      
      let totalTimeDiff = 0;
      let timeDiffCount = 0;
      
      // Calculate time difference between consecutive blocks
      for (let i = 1; i < blocks.length; i++) {
        const timeDiff = blocks[i].timestamp.getTime() - blocks[i-1].timestamp.getTime();
        totalTimeDiff += timeDiff;
        timeDiffCount++;
      }
      
      // Calculate average in seconds
      avgBlockTime = timeDiffCount > 0 ? (totalTimeDiff / timeDiffCount) / 1000 : 0;
    }
    
    // Update or create stats document for today
    await Stats.findOneAndUpdate(
      { date: today },
      { 
        txCount,
        blockCount,
        avgTxFee,
        avgBlockTime,
        contractClassCount,
        accountCount,
        lastUpdated: new Date()
      },
      { upsert: true }
    );
    
    console.log(`Stats updated for ${today.toISOString().split('T')[0]}: ${txCount} transactions, ${blockCount} blocks, avg fee: ${avgTxFee}, avg block time: ${avgBlockTime}s`);
  } catch (error) {
    console.error('Error updating daily stats:', error instanceof Error ? error.message : error);
  }
};

/**
 * Retroactively generates and indexes statistics going backward in time
 * @param startDate The date to start indexing from (defaults to today)
 * @param maxDays Maximum number of days to process (optional safety limit)
 */
export const indexHistoricalStats = async (startDate?: Date, maxDays = 100): Promise<void> => {
  try {
    // Default startDate to today if not provided
    if (!startDate) {
      startDate = new Date();
    }
    
    // Normalize date to start of day
    startDate.setHours(0, 0, 0, 0);
    
    console.log(`Starting backward historical stats indexing from ${startDate.toISOString().split('T')[0]}`);
    
    // Initialize the current date to process
    const currentDate = new Date(startDate);
    let daysProcessed = 0;
    let emptyDaysCount = 0;
    
    // Process each day going backward until finding no data or reaching safety limit
    while (daysProcessed < maxDays) {
      // Create the next day date for query range
      const nextDate = new Date(currentDate);
      nextDate.setDate(nextDate.getDate() + 1);
      
      // Count transactions and blocks for this day
      const txCount = await Transaction.countDocuments({
        timestamp: { $gte: currentDate, $lt: nextDate }
      });
      
      const blockCount = await Block.countDocuments({
        timestamp: { $gte: currentDate, $lt: nextDate }
      });

      const contractClassCount = await ContractClass.countDocuments({
        creationTimestamp: { $gte: currentDate, $lt: nextDate }
      });

      const accountCount = await Account.countDocuments({
        creationTimestamp: { $gte: currentDate, $lt: nextDate }
      });
      
      // Calculate avg tx fee for the day
      let avgTxFee = 0;
      if (txCount > 0) {
        const txs = await Transaction.find(
          { timestamp: { $gte: currentDate, $lt: nextDate } },
          { transactionFee: 1, _id: 0 }
        );
        
        const totalFees = txs.reduce((sum, tx) => sum + (tx.transactionFee || 0), 0);
        avgTxFee = totalFees / txs.length;
      }
      
      // Calculate average block time
      let avgBlockTime = 0;
      if (blockCount > 1) {
        // Get all blocks for the day sorted by timestamp
        const blocks = await Block.find(
          { timestamp: { $gte: currentDate, $lt: nextDate } },
          { timestamp: 1, _id: 0 }
        ).sort({ timestamp: 1 });
        
        let totalTimeDiff = 0;
        let timeDiffCount = 0;
        
        // Calculate time difference between consecutive blocks
        for (let i = 1; i < blocks.length; i++) {
          const timeDiff = blocks[i].timestamp.getTime() - blocks[i-1].timestamp.getTime();
          totalTimeDiff += timeDiff;
          timeDiffCount++;
        }
        
        // Calculate average in seconds
        avgBlockTime = timeDiffCount > 0 ? (totalTimeDiff / timeDiffCount) / 1000 : 0;
      }
      
      // If we've found 3 consecutive days with no data, stop processing
      if (txCount === 0 && blockCount === 0) {
        emptyDaysCount++;
        if (emptyDaysCount >= 5) {
          console.log(`No more data found after ${emptyDaysCount} empty days. Stopping indexing.`);
          break;
        }
      } else {
        // Reset empty days counter if we found data
        emptyDaysCount = 0;
      }
      
      // Update or create stats document for this day
      await Stats.findOneAndUpdate(
        { date: new Date(currentDate) },
        { 
          txCount,
          blockCount,
          avgTxFee,
          avgBlockTime,
          contractClassCount,
          accountCount,
          lastUpdated: new Date()
        },
        { upsert: true }
      );
      
      console.log(`Historical stats indexed for ${currentDate.toISOString().split('T')[0]}: ${txCount} transactions, ${blockCount} blocks, avg fee: ${avgTxFee}, avg block time: ${avgBlockTime}s`);
      
      // Move to previous day
      currentDate.setDate(currentDate.getDate() - 1);
      daysProcessed++;
    }
    
    if (daysProcessed >= maxDays) {
      console.log(`Reached maximum days limit (${maxDays}). Stopping indexing.`);
    }
    
    console.log(`Historical stats indexing completed. Processed ${daysProcessed} days.`);
  } catch (error) {
    console.error('Error indexing historical stats:', error instanceof Error ? error.message : error);
  }
};
