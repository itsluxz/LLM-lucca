import { Mascot } from './Mascot';
export function MascotBubble({ text }: { text: string }) {
  return (
    <div className="mascot-bubble">
      <Mascot mood="wink" size={42} />
      <span>{text}</span>
    </div>
  );
}
