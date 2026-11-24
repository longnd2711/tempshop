interface FloatingContactButtonsProps {
  hasMobileCartBar: boolean;
}

export function FloatingContactButtons({
  hasMobileCartBar,
}: FloatingContactButtonsProps) {
  return (
    <div
      aria-label="Liên hệ nhanh qua Zalo và Facebook"
      className={`fixed right-3 sm:right-4 z-30 flex items-center gap-2 sm:gap-2.5 transition-all ${
        hasMobileCartBar ? 'bottom-[70px] md:bottom-5' : 'bottom-4 md:bottom-5'
      }`}
    >
      <a
        href="https://zalo.me/0916319452"
        target="_blank"
        rel="noopener noreferrer"
        aria-label="Liên hệ Zalo 0916319452"
        title="Nhắn Zalo 0916319452"
        className="w-11 h-11 sm:w-12 sm:h-12 rounded-full bg-[#0068FF] hover:bg-[#0055D4] text-white shadow-lg flex items-center justify-center transition-transform duration-150 hover:-translate-y-0.5 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0068FF]"
      >
        <svg
          viewBox="0 0 48 48"
          className="w-6 h-6 sm:w-7 sm:h-7"
          fill="none"
          aria-hidden="true"
        >
          <path
            d="M24 7C14.06 7 6 13.94 6 22.5c0 4.86 2.61 9.2 6.72 12.04l-1.5 5.46 5.83-2.96c2.17.63 4.52.96 6.95.96 9.94 0 18-6.94 18-15.5S33.94 7 24 7Z"
            fill="currentColor"
          />
          <text
            x="24"
            y="26.5"
            textAnchor="middle"
            fill="#0068FF"
            fontSize="11.5"
            fontWeight="700"
            fontFamily="system-ui, sans-serif"
          >
            Zalo
          </text>
        </svg>
      </a>

      <a
        href="https://m.me/thuhuong.nguyen.180"
        target="_blank"
        rel="noopener noreferrer"
        aria-label="Nhắn tin Facebook Messenger thuhuong.nguyen.180"
        title="Nhắn Facebook thuhuong.nguyen.180"
        className="w-11 h-11 sm:w-12 sm:h-12 rounded-full bg-[#1877F2] hover:bg-[#1465D0] text-white shadow-lg flex items-center justify-center transition-transform duration-150 hover:-translate-y-0.5 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1877F2]"
      >
        <svg
          viewBox="0 0 24 24"
          className="w-5 h-5 sm:w-6 sm:h-6"
          fill="currentColor"
          aria-hidden="true"
        >
          <path d="M14 13.5h2.5l1-4H14v-2c0-1.03 0-2 2-2h1.5V2.14c-.326-.043-1.557-.14-2.857-.14C11.928 2 10 3.657 10 6.7v2.8H7v4h3V22h4v-8.5Z" />
        </svg>
      </a>
    </div>
  );
}
