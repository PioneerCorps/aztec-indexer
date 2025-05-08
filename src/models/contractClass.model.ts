import { Schema, model, Document } from 'mongoose';
import { FunctionAbi } from '../interfaces/aztec.interfaces.js'; // Assuming FunctionAbi is in this path

// Interface for the ContractClass document
interface IContractClass extends Document {
    id: string; // Fr is typically a hex string
    artifactHash: string; // Fr
    privateFunctionsRoot: string; // Fr
    packedBytecode: Buffer;
    publicFunctions: FunctionAbi[];
    version: number;
    blockNumber: number;
    blockHash: string;
    txHash: string;
    creationTimestamp: Date;
    // Potentially other fields from ContractClassPublicSchema if needed
}

// Mongoose schema for ContractClass
const contractClassSchema = new Schema<IContractClass>({
    id: { type: String, required: true, unique: true },
    artifactHash: { type: String, required: true },
    privateFunctionsRoot: { type: String, required: true },
    packedBytecode: { type: Buffer, required: true },
    publicFunctions: { type: [Object], required: true }, // Array of FunctionAbi objects
    version: { type: Number, required: true },
    blockNumber: { type: Number, required: true },
    blockHash: { type: String, required: true },
    txHash: { type: String, required: true },
    creationTimestamp: { type: Date, default: Date.now },
});

// Mongoose model for ContractClass
export const ContractClass = model<IContractClass>('ContractClass', contractClassSchema);