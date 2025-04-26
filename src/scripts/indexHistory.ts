import { connectDB } from '../utils/db.js';
import { indexHistoricalStats } from '../utils/stats.js';

async function main() {
  // Connect to the database
  await connectDB();
  
  // Parse command line arguments
  const args = process.argv.slice(2);
  
  let startDate: Date | undefined;
  let maxDays: number = 1000; // Default safety limit
  
  // Parse start date if provided
  if (args.length > 0 && args[0] !== '--max') {
    try {
      startDate = new Date(args[0]);
      if (isNaN(startDate.getTime())) {
        throw new Error('Invalid date format');
      }
      console.log(`Starting indexing from: ${startDate.toISOString().split('T')[0]}`);
    } catch (error) {
      console.error('Error: Invalid start date format. Please use YYYY-MM-DD format.');
      process.exit(1);
      return; // For TypeScript
    }
  } else {
    console.log('No start date specified. Using today as the starting point.');
  }
  
  // Parse max days if provided
  const maxDaysArg = args.findIndex(arg => arg === '--max');
  if (maxDaysArg !== -1 && args.length > maxDaysArg + 1) {
    const parsedMaxDays = parseInt(args[maxDaysArg + 1], 10);
    if (!isNaN(parsedMaxDays) && parsedMaxDays > 0) {
      maxDays = parsedMaxDays;
      console.log(`Using maximum of ${maxDays} days to process.`);
    } else {
      console.error('Error: Invalid max days value. Please provide a positive number.');
      process.exit(1);
      return; // For TypeScript
    }
  }
  
  console.log('Starting historical stats indexing (backwards in time)...');
  await indexHistoricalStats(startDate, maxDays);
  console.log('Finished indexing historical stats');
  
  process.exit(0);
}

// Run the main function
main().catch(error => {
  console.error('Error:', error);
  process.exit(1);
}); 