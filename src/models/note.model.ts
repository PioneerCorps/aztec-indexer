import { Schema, model, Document } from 'mongoose';

interface INote extends Document {
    note: string;
    owner: string;
    contractAddress: string;
    storageSlot: string;
    noteType: string;
    txHash: string;
}

const noteSchema = new Schema<INote>({
    note: { type: String, required: true },
    owner: { type: String, required: true },
    contractAddress: { type: String, required: true },
    storageSlot: { type: String, required: true },
    noteType: { type: String, required: true },
    txHash: { type: String, required: true },
});

const Note = model<INote>('Note', noteSchema);

export default Note;