import { Schema, model, Document,Model } from 'mongoose';
import { FinalityStatus } from '../utils/finality.js';

interface IBlock extends Document {
    hash: string;
    number: number;
    previousHash: string;
    timestamp: Date;
    coinbaseAccount: string;
    totalFees: string;
    feeRecipient: string;
    txCount: number;
    paddingTxCount: number;
    size: number;
    feePerDaGas: number;
    feePerL2Gas: number;
    startStateHash: string;
    endStateHash: string;
    finalityStatus?: string;
}

const blockSchema = new Schema<IBlock>({
    hash: { type: String, required: true },
    number: { type: Number, required: true },
    //previousHash: { type: String, required: true },
    timestamp: { type: Date, required: true },
    coinbaseAccount: { type: String, required: true },
    totalFees: { type: String, required: true },
    feeRecipient: { type: String, required: true },
    txCount: { type: Number, required: true },
    paddingTxCount: { type: Number, required: true },
    size: { type: Number, required: true },
    feePerDaGas: { type: Number, required: true },
    feePerL2Gas: { type: Number, required: true },
    startStateHash: { type: String, required: true },
    endStateHash: { type: String, required: true },
    finalityStatus: { 
        type: String, 
        enum: Object.values(FinalityStatus),
        default: FinalityStatus.PRECONFIRMED 
    }
});

// Add indexes for common queries
blockSchema.index({ number: 1 }, { unique: true });
blockSchema.index({ hash: 1 }, { unique: true });
blockSchema.index({ timestamp: -1 });
blockSchema.index({ finalityStatus: 1 });

const Block = model<IBlock>('Block', blockSchema);

export default Block;
export { IBlock };