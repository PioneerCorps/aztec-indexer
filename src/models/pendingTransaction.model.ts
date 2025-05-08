import { Schema, model, Document } from 'mongoose';

// Tx sınıfındaki alanlara karşılık gelen arayüz
// Gerçek Tx yapısı daha karmaşık olabilir, bu temel bir temsildir.
interface IPendingTransaction extends Document {
  hash: string;
  data: string; // PrivateKernelTailCircuitPublicInputs'ın serileştirilmiş hali (JSON string veya Buffer hex)
  clientIvcProof: string; // ClientIvcProof'un serileştirilmiş hali
  contractClassLogs: string[]; // ContractClassLog dizisinin serileştirilmiş hali
  publicFunctionCalldata: string[]; // HashedValues dizisinin serileştirilmiş hali
  timestamp: Date; // İşlemin alındığı zaman damgası
}

const PendingTransactionSchema = new Schema<IPendingTransaction>({
  hash: { type: String, required: true, unique: true, index: true },
  data: { type: String, required: true },
  clientIvcProof: { type: String, required: true },
  contractClassLogs: [{ type: String }],
  publicFunctionCalldata: [{ type: String }],
  timestamp: { type: Date, default: Date.now },
});

const PendingTransaction = model<IPendingTransaction>('PendingTransaction', PendingTransactionSchema);

export default PendingTransaction;