import mongoose, { Document, Schema } from 'mongoose';

export interface IReorg extends Document {
  timestamp: Date;
  startBlock: number;
  endBlock: number;
  length: number;
  affectedTxCount: number;
  blocks: Array<{
    number: number;
    hash: string;
  }>;
}

const ReorgSchema = new Schema({
  timestamp: {
    type: Date,
    required: true,
    default: Date.now
  },
  startBlock: {
    type: Number,
    required: true
  },
  endBlock: {
    type: Number,
    required: true
  },
  length: {
    type: Number,
    required: true
  },
  affectedTxCount: {
    type: Number,
    required: true
  },
  blocks: [{
    number: {
      type: Number,
      required: true
    },
    hash: {
      type: String,
      required: true
    },
    _id: false
  }]
});

// Create indexes for efficient queries
ReorgSchema.index({ timestamp: -1 });
ReorgSchema.index({ startBlock: 1, endBlock: 1 });
ReorgSchema.index({ length: -1 });

const Reorg = mongoose.model<IReorg>('Reorg', ReorgSchema);

export default Reorg; 