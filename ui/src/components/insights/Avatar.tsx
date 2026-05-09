import { useMemo } from "react";
import { createAvatar } from "@dicebear/core";
import { notionists } from "@dicebear/collection";

interface Props {
  seed: string;
  size?: number;
  className?: string;
}

const BG = ["FFE066", "B8F5C9", "A0E7FF", "C8B6FF", "FFB7A8"];

export function Avatar({ seed, size = 36, className }: Props) {
  const dataUri = useMemo(
    () =>
      createAvatar(notionists, {
        seed,
        size,
        backgroundColor: BG,
        backgroundType: ["solid"],
      }).toDataUri(),
    [seed, size],
  );
  return (
    <div
      className={`avatar${className ? " " + className : ""}`}
      style={{ width: size, height: size }}
    >
      <img src={dataUri} alt="" width={size} height={size} draggable={false} />
    </div>
  );
}
