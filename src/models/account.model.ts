import { Schema, model, Document, Model } from 'mongoose';
import { FunctionAbi } from '../interfaces/aztec.interfaces.js'; // FunctionAbi arayüzünü içe aktarın

interface IAccount extends Document {
    address: string;
    version: number;
    deployer: string;
    contractClassID: string;
    isContract: boolean;
    balance: string;
    functions: FunctionAbi[];
    byteCode: string;
    name: string;
    privateFunctionsRoot: string;
}

const accountSchema = new Schema<IAccount>({
    address: { type: String, required: true },
    version: { type: Number, required: true },
    deployer: { type: String, required: true },
    contractClassID: { type: String, required: true },
    isContract: { type: Boolean, required: true },
    balance: { type: String, required: true },
    functions: { type: [Object], required: true },
    byteCode: { type: String, required: true },
    name: { type: String, required: true },
    privateFunctionsRoot: { type: String, required: true },
});

const accountSchema2 = new Schema<IAccount>({
    address: { type: String, required: true },
    version: { type: Number, required: true },
    deployer: { type: String, required: true },
    contractClassID: { type: String, required: true },
    isContract: { type: Boolean, required: true },
    balance: { type: String, required: true },
    functions: { type: [Object], required: true },
    byteCode: { type: String, required: true },
    name: { type: String, required: true },
    privateFunctionsRoot: { type: String, required: true },
});

export const Account = model<IAccount>('Account', accountSchema);
export const Account2 = model<IAccount>('Account2', accountSchema2);
