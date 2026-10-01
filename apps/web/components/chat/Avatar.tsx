import { colorFor, initials } from '@/lib/chatUtils';

export function Avatar({ id, name, size = 40 }: { id: string; name: string; size?: number }) {
  return (
    <span
      aria-hidden="true"
      className="inline-flex shrink-0 items-center justify-center rounded-full font-medium text-white"
      style={{ width: size, height: size, background: colorFor(id), fontSize: size * 0.4 }}
    >
      {initials(name)}
    </span>
  );
}
