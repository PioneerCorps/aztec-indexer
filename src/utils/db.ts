import mongoose from 'mongoose';

export const connectDB = async () => {
  try {
    const conn = await mongoose.connect('mongodb://mongo:27017/yourDatabaseName', {
        autoCreate: true,
        autoIndex: true,    
    });
    console.log(`MongoDB Connected: ${conn.connection.host}`);
  } catch (error) {
    console.error(`Error: ${error}`);
    process.exit(1);
  }
};
