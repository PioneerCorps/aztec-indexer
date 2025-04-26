import { Schema, model, Document, Model } from 'mongoose';

interface ITransaction extends Document {
    hash: string;
    blockNumber: number;
    blockHash: string;
    index: number;
    revertCode: string;
    timestamp: Date;
    transactionFee: number;
    noteHashes: string;
    nullifiers: string;
    l2ToL1Msgs: string;
    publicDataWrites: string;
    unencryptedLogsLength: number;
    uneencryptedLogs: string;
    encryptedLogs?: string;
}

const transactionSchema = new Schema<ITransaction>({
    hash: { type: String, required: true },
    index: { type: Number, required: true },
    blockNumber: { type: Number, required: true },
    blockHash: { type: String, required: true },
    revertCode: { type: String, required: true },
    timestamp: { type: Date, required: true },
    transactionFee: { type: Number, required: true },
    noteHashes: { type: String, required: true },
    nullifiers: { type: String, required: true },
    l2ToL1Msgs: { type: String, required: true },
    publicDataWrites: { type: String, required: true },
    unencryptedLogsLength: { type: Number, required: true },
    uneencryptedLogs: { type: String, required: true },
    encryptedLogs: { type: String, required: false }
});

const Transaction = model<ITransaction>('Transaction', transactionSchema);

export default Transaction;