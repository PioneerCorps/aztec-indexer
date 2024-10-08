import { Schema, model, Document,Model } from 'mongoose';

interface IBlock extends Document {
    hash: string;
    number: number;
    previousHash: string;
    timestamp: Date;
    coinbaseAccount: string;
    totalFees: number;
    feeRecipient: string;
    txCount: number;
    paddingTxCount: number;
    size: number;
    feePerDaGas: number;
    feePerL2Gas: number;
}

const blockSchema = new Schema<IBlock>({
    hash: { type: String, required: true },
    number: { type: Number, required: true },
    //previousHash: { type: String, required: true },
    timestamp: { type: Date, required: true },
    coinbaseAccount: { type: String, required: true },
    totalFees: { type: Number, required: true },
    feeRecipient: { type: String, required: true },
    txCount: { type: Number, required: true },
    paddingTxCount: { type: Number, required: true },
    size: { type: Number, required: true },
    feePerDaGas: { type: Number, required: true },
    feePerL2Gas: { type: Number, required: true },
});

const Block = model<IBlock>('Block', blockSchema);

export default Block;