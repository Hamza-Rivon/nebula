import { useMemo } from "react";
import { createAvatar } from "@dicebear/core";
import { notionists } from "@dicebear/collection";

interface Props {
  seed: string;
  size?: number;
  className?: string;
}

// Notionists avatars — the most editorial of dicebear's options.
// Mute the palette to play with our dark surface.
const PALETTE = ["c5cad5", "8a93a4", "5a6273", "4f8ebe", "8eb4d4"];
const BG = ["1a2030", "13182230"];

export default function Avatar({ seed, size = 32, className }: Props) {
  const dataUri = useMemo(() => {
    return createAvatar(notionists, {
      seed,
      size,
      backgroundColor: BG,
      backgroundType: ["solid"],
      // notionists doesn't expose all options here, but seed → deterministic
    }).toDataUri();
  }, [seed, size]);

  return (
    <div
      className={`avatar${className ? " " + className : ""}`}
      style={{ width: size, height: size, color: PALETTE[0] }}
    >
      <img src={dataUri} alt="" width={size} height={size} draggable={false} />
    </div>
  );
}
