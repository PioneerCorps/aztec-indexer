import { Schema, model, Document,Model } from 'mongoose';

interface IAccount extends Document {
    address: string;
    version: number;
    deployer: string;
    contractClassID: string;
    isContract: boolean;
    balance: string;
}

const accountSchema = new Schema<IAccount>({
    address: { type: String, required: true },
    version: { type: Number, required: true },
    deployer: { type: String, required: true },
    contractClassID: { type: String, required: true },
    isContract: { type: Boolean, required: true },
    balance: { type: String, required: true }
});

const Account = model<IAccount>('Account', accountSchema);

export default Account;