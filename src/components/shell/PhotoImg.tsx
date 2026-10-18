import Image from 'next/image';

/** The photo route needs the session cookie, which the image optimizer would not send. */
export function PhotoImg({ src, size }: { src: string; size: number }) {
  return <Image className="ph-img" src={src} alt="" width={size} height={size} unoptimized />;
}
