import ChoiceCard from "./ChoiceCard";
import type { ReactNode } from "react";

export interface ChoiceGroupItem {
  key: string;
  title: string;
  description?: string;
  icon?: ReactNode;
  dividerBefore?: boolean;
  muted?: boolean;
}

export interface ChoiceGroupProps {
  ariaLabel: string;
  items: ChoiceGroupItem[];
  selectedKeys: string[];
  disabledKeys?: string[];
  onToggle: (key: string) => void;
  className?: string;
}

export default function ChoiceGroup({
  ariaLabel,
  items,
  selectedKeys,
  disabledKeys = [],
  onToggle,
  className = "",
}: ChoiceGroupProps) {
  return (
    <div
      role="group"
      aria-label={ariaLabel}
      className={["grid grid-cols-1 gap-[10px] md:grid-cols-2 md:gap-[11px]", className].join(
        " ",
      )}
    >
      {items.map((item) => {
        const card = (
          <ChoiceCard
            title={item.title}
            description={item.description}
            icon={item.icon}
            selected={selectedKeys.includes(item.key)}
            disabled={disabledKeys.includes(item.key)}
            onClick={() => onToggle(item.key)}
            className={item.muted ? "border-dashed italic" : undefined}
          />
        );

        if (item.dividerBefore) {
          return (
            <div key={item.key} className="contents">
              <div aria-hidden="true" className="col-span-full mx-[2px] my-[4px] h-px bg-[#F1EDE6]" />
              {card}
            </div>
          );
        }

        return (
          <div key={item.key} className="contents">
            {card}
          </div>
        );
      })}
    </div>
  );
}
