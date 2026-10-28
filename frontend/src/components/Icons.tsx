import type { ReactNode } from "react";

const S = ({ children, size = 20, w = 1.8 }: { children: ReactNode; size?: number; w?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={w}
    strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{children}</svg>
);
type P = { size?: number };
export const IGrid = (p: P) => <S {...p}><rect x="3" y="3" width="7" height="7" rx="1.5" /><rect x="14" y="3" width="7" height="7" rx="1.5" /><rect x="3" y="14" width="7" height="7" rx="1.5" /><rect x="14" y="14" width="7" height="7" rx="1.5" /></S>;
export const IBriefcase = (p: P) => <S {...p}><rect x="3" y="7" width="18" height="13" rx="2" /><path d="M8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M3 13h18" /></S>;
export const IFile = (p: P) => <S {...p}><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" /><path d="M14 3v5h5M9 13h6M9 17h6" /></S>;
export const IShield = (p: P) => <S {...p}><path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z" /></S>;
export const IChat = (p: P) => <S {...p}><path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z" /></S>;
export const IBell = (p: P) => <S {...p}><path d="M6 8a6 6 0 1 1 12 0c0 7 3 9 3 9H3s3-2 3-9" /><path d="M10.3 21a1.9 1.9 0 0 0 3.4 0" /></S>;
export const IUsers = (p: P) => <S {...p}><circle cx="9" cy="8" r="3.5" /><path d="M2.5 20a6.5 6.5 0 0 1 13 0" /><path d="M16 4.5a3.5 3.5 0 0 1 0 7M21.5 20a6.5 6.5 0 0 0-4-6" /></S>;
export const IPause = (p: P) => <S {...p}><circle cx="12" cy="12" r="9" /><path d="M10 9v6M14 9v6" /></S>;
export const ISliders = (p: P) => <S {...p}><path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12" /><circle cx="16" cy="6" r="2" /><circle cx="10" cy="12" r="2" /><circle cx="18" cy="18" r="2" /></S>;
export const IList = (p: P) => <S {...p}><path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01" /></S>;
export const IPlus = (p: P) => <S {...p} w={2.2}><path d="M12 5v14M5 12h14" /></S>;
export const IArrow = (p: P) => <S {...p} w={2.2}><path d="M5 12h14M13 6l6 6-6 6" /></S>;
export const IBack = (p: P) => <S {...p} w={2.2}><path d="M19 12H5M11 6l-6 6 6 6" /></S>;
export const ICheck = (p: P) => <S {...p} w={2.6}><path d="M5 12l5 5L20 7" /></S>;
export const IX = (p: P) => <S {...p} w={2.4}><path d="M6 6l12 12M18 6L6 18" /></S>;
export const IAlert = (p: P) => <S {...p} w={2}><path d="M12 9v4M12 17h.01" /><path d="M10.3 3.9L2 18a2 2 0 0 0 1.7 3h16.6a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" /></S>;
export const ICal = (p: P) => <S {...p}><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M16 3v4M8 3v4M3 10h18" /></S>;
export const IPlug = (p: P) => <S {...p}><path d="M9 3v5M15 3v5M6 8h12v3a6 6 0 0 1-12 0zM12 17v4" /></S>;
export const ISpark = (p: P) => <S {...p} w={2}><path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z" /></S>;
export const IDownload = (p: P) => <S {...p} w={2}><path d="M12 4v12M7 11l5 5 5-5M4 20h16" /></S>;
export const ILock = (p: P) => <S {...p} w={2}><rect x="5" y="11" width="14" height="10" rx="2" /><path d="M8 11V7a4 4 0 0 1 8 0v4" /></S>;
export const IUser = (p: P) => <S {...p}><circle cx="12" cy="8" r="4" /><path d="M4 21a8 8 0 0 1 16 0" /></S>;
export const IStar = (p: P) => <S {...p}><path d="m12 3 2.6 5.6 6.1.7-4.5 4.2 1.2 6L12 16.6 6.6 19.5l1.2-6L3.3 9.3l6.1-.7z" /></S>;
