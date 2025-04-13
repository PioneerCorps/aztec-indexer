import mongoose from 'mongoose';

export const connectDB = async () => {
  const { DB_URL = 'mongodb://localhost:27017/aztec' } = process.env;
  try {
    const conn = await mongoose.connect('mongodb://localhost:27017/aztec', {
        autoCreate: true,
        autoIndex: true,    
    });
    console.log(`MongoDB Connected: ${conn.connection.host}`);
  } catch (error) {
    console.error(`Error: ${error}`);
    process.exit(1);
  }
};
