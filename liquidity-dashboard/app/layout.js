import "./globals.css";

export const metadata = {
  title: "월가 유동성 스트레스 대시보드",
  description: "딜러 레버리지 · CFTC 국채선물 포지셔닝 자동 갱신 대시보드",
};

export default function RootLayout({ children }) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  );
}
