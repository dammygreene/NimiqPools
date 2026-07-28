import type { SVGProps } from "react";

type IconProps = SVGProps<SVGSVGElement> & { size?: number; weight?: "regular" | "bold" };

function IconBase({ size = 20, weight = "regular", children, ...props }: IconProps & { children: React.ReactNode }) {
  const strokeWidth = weight === "bold" ? 2.2 : 1.8;
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false" {...props}>
      {children}
    </svg>
  );
}

export function HouseIcon(props: IconProps) { return <IconBase {...props}><path d="M3 10.5 12 3l9 7.5"/><path d="M5.5 9.5V21h13V9.5"/><path d="M9.5 21v-7h5v7"/></IconBase>; }
export function PlusCircleIcon(props: IconProps) { return <IconBase {...props}><circle cx="12" cy="12" r="9"/><path d="M12 8v8M8 12h8"/></IconBase>; }
export function ClockCounterClockwiseIcon(props: IconProps) { return <IconBase {...props}><path d="M3 12a9 9 0 1 0 3-6.7"/><path d="M3 4v5h5"/><path d="M12 7v5l3 2"/></IconBase>; }
export function SunIcon(props: IconProps) { return <IconBase {...props}><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.42 1.42M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.42-1.41M17.66 6.34l1.41-1.41"/></IconBase>; }
export function MoonIcon(props: IconProps) { return <IconBase {...props}><path d="M20.5 14.5A8 8 0 0 1 9.5 3.5 8.5 8.5 0 1 0 20.5 14.5Z"/></IconBase>; }
export function CheckIcon(props: IconProps) { return <IconBase {...props}><path d="m5 12 4 4L19 6"/></IconBase>; }
export function ArrowRightIcon(props: IconProps) { return <IconBase {...props}><path d="M5 12h14M14 7l5 5-5 5"/></IconBase>; }
export function ArrowLeftIcon(props: IconProps) { return <IconBase {...props}><path d="M19 12H5M10 7l-5 5 5 5"/></IconBase>; }
export function CircleIcon(props: IconProps) { return <IconBase {...props}><circle cx="12" cy="12" r="7"/></IconBase>; }
export function CurrencyCircleDollarIcon(props: IconProps) { return <IconBase {...props}><circle cx="12" cy="12" r="9"/><path d="M15 8.5c-.7-.7-1.7-1-3-1-1.7 0-3 .9-3 2.2 0 3.3 6 1.5 6 4.6 0 1.3-1.3 2.2-3 2.2-1.3 0-2.5-.4-3.3-1.2M12 5.5v13"/></IconBase>; }
export function SoccerBallIcon(props: IconProps) { return <IconBase {...props}><circle cx="12" cy="12" r="9"/><path d="m9.2 8.7 2.8-2 2.8 2-1.1 3.3h-3.4L9.2 8.7Z"/><path d="m6.3 14.8 4-2.8M17.7 14.8l-4-2.8M9.2 8.7 6.4 7.6M14.8 8.7l2.8-1.1M8.5 19.2l-2.2-4.4M15.5 19.2l2.2-4.4"/></IconBase>; }
export function CloudSunIcon(props: IconProps) { return <IconBase {...props}><path d="M8 17h9a4 4 0 0 0 .4-8 6 6 0 0 0-11.2 2A3 3 0 0 0 8 17Z"/><path d="M14 3v2M19.7 5.3l-1.4 1.4M22 11h-2"/></IconBase>; }
export function UsersThreeIcon(props: IconProps) { return <IconBase {...props}><circle cx="12" cy="8" r="3"/><path d="M6 20a6 6 0 0 1 12 0M5.5 9a2.5 2.5 0 0 0 0 5M18.5 9a2.5 2.5 0 0 1 0 5M2 20a4 4 0 0 1 4-4M22 20a4 4 0 0 0-4-4"/></IconBase>; }
export function ShieldCheckIcon(props: IconProps) { return <IconBase {...props}><path d="M12 3 5 6v5c0 4.8 2.8 8 7 10 4.2-2 7-5.2 7-10V6l-7-3Z"/><path d="m9 12 2 2 4-4"/></IconBase>; }
export function GiftIcon(props: IconProps) { return <IconBase {...props}><path d="M4 10h16v10H4z"/><path d="M2.5 7h19v3h-19zM12 7v13"/><path d="M12 7H8.5A2.5 2.5 0 1 1 11 4.5L12 7ZM12 7h3.5A2.5 2.5 0 1 0 13 4.5L12 7Z"/></IconBase>; }
export function LinkIcon(props: IconProps) { return <IconBase {...props}><path d="M10 13a5 5 0 0 0 7.1.1l2-2a5 5 0 0 0-7.1-7.1l-1.1 1.1"/><path d="M14 11a5 5 0 0 0-7.1-.1l-2 2A5 5 0 0 0 12 20l1.1-1.1"/></IconBase>; }
export function CopyIcon(props: IconProps) { return <IconBase {...props}><rect x="8" y="8" width="11" height="11" rx="2"/><path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3"/></IconBase>; }
export function ShareNetworkIcon(props: IconProps) { return <IconBase {...props}><circle cx="18" cy="5" r="2.5"/><circle cx="6" cy="12" r="2.5"/><circle cx="18" cy="19" r="2.5"/><path d="m8.2 10.8 7.6-4.6M8.2 13.2l7.6 4.6"/></IconBase>; }
export function RankingIcon(props: IconProps) { return <IconBase {...props}><path d="M5 20v-7h4v7M10 20V5h4v15M15 20v-11h4v11"/></IconBase>; }
