import mongoose, { Document, Schema } from 'mongoose';

interface IStats extends Document {
  date: Date;
  txCount: number;
  blockCount: number;
  avgTxFee: number;
  avgBlockTime: number;
  contractClassCount: number;
  accountCount: number;
  lastUpdated: Date;
}

const statsSchema = new Schema({
  date: { 
    type: Date, 
    required: true,
    unique: true,
    index: true 
  },
  txCount: { 
    type: Number, 
    default: 0 
  },
  blockCount: { 
    type: Number, 
    default: 0 
  },
  avgTxFee: {
    type: Number,
    default: 0
  },
  avgBlockTime: {
    type: Number,
    default: 0
  },
  lastUpdated: { 
    type: Date, 
    default: Date.now 
  },
  contractClassCount: { 
    type: Number, 
    default: 0 
  },
  accountCount: {
    type: Number,
    default: 0
  }
});

// Create a compound index for optimization
statsSchema.index({ date: 1 });

const Stats = mongoose.model<IStats>('Stats', statsSchema);

export default Stats; 