/* English ⇄ Thai language switch.
   The UI is written in English; this file translates rendered text in place (text nodes,
   placeholders, titles), including content rendered later, and restores English when
   switched back. Add new strings to TH (exact text) or TH_PATTERNS (text with numbers). */
'use strict';

const I18N = (() => {
  const TH = {
    // ---------- navigation & auth ----------
    'Trade': 'เทรด', 'Markets': 'ตลาด', 'Portfolio': 'พอร์ตโฟลิโอ', 'Wallet': 'กระเป๋าเงิน', 'Admin': 'ผู้ดูแลระบบ',
    'Dashboard': 'แดชบอร์ด', 'Customers': 'ลูกค้า', 'Transactions': 'ธุรกรรม', 'Orders': 'คำสั่งเทรด', 'Trading app': 'แอปเทรด',
    'Log in': 'เข้าสู่ระบบ', 'Log out': 'ออกจากระบบ', 'Sign in': 'เข้าสู่ระบบ', 'Create account': 'สร้างบัญชี',
    'Sign in to start trading': 'เข้าสู่ระบบเพื่อเริ่มเทรด', 'Open a demo account in seconds': 'เปิดบัญชีทดลองได้ในไม่กี่วินาที',
    'Back office sign in': 'เข้าสู่ระบบหลังบ้าน', 'Full name': 'ชื่อ-นามสกุล', 'Email': 'อีเมล', 'Password': 'รหัสผ่าน',
    'Trader': 'เทรดเดอร์', 'ADMIN': 'แอดมิน', 'Live feed': 'ข้อมูลสด',
    'This account is not an administrator': 'บัญชีนี้ไม่ใช่ผู้ดูแลระบบ',

    // ---------- trade screen ----------
    'Perp': 'Perp', 'Last': 'ราคาล่าสุด', 'price': '', // "Last <symbol> price" -> "ราคาล่าสุด <symbol>"
    '24h change': 'เปลี่ยนแปลง 24 ชม.', '24h high': 'สูงสุด 24 ชม.', '24h low': 'ต่ำสุด 24 ชม.', '24h volume': 'ปริมาณ 24 ชม.',
    'Scroll to zoom · drag to pan · double-click to reset': 'เลื่อนเพื่อซูม · ลากเพื่อเลื่อน · ดับเบิลคลิกเพื่อรีเซ็ต',
    'Positions': 'โพซิชัน', 'Open orders': 'คำสั่งที่รอจับคู่', 'History': 'ประวัติ',
    'Buy / Long': 'ซื้อ / Long', 'Sell / Short': 'ขาย / Short', 'Available': 'ยอดที่ใช้ได้',
    'Order type': 'ประเภทคำสั่ง', 'Market': 'ตลาด', 'Limit': 'ลิมิต', 'Limit price': 'ราคาลิมิต',
    'Leverage': 'เลเวอเรจ', 'Margin (cost)': 'มาร์จิ้น (ต้นทุน)', 'Max': 'สูงสุด',
    'Take profit': 'ทำกำไร (TP)', 'Stop loss': 'ตัดขาดทุน (SL)', 'Trigger price': 'ราคาทริกเกอร์',
    'Entry price': 'ราคาเข้า', 'Position size': 'ขนาดโพซิชัน', 'Position value': 'มูลค่าโพซิชัน',
    'Est. liquidation': 'ราคาถูกบังคับปิดโดยประมาณ', 'Fee': 'ค่าธรรมเนียม', 'Total cost': 'ต้นทุนรวม',
    'Insufficient balance': 'ยอดเงินไม่เพียงพอ', 'Enter a margin amount': 'กรุณาใส่จำนวนมาร์จิ้น',
    'Loading…': 'กำลังโหลด…',
    // table headers
    'Side': 'ฝั่ง', 'Size': 'ขนาด', 'Margin': 'มาร์จิ้น', 'Entry': 'ราคาเข้า', 'Mark': 'ราคาปัจจุบัน', 'Liq.': 'ราคาบังคับปิด',
    'TP / SL': 'TP / SL', 'PnL (ROE)': 'กำไร/ขาดทุน (ROE)', 'PnL': 'กำไร/ขาดทุน', 'Exit': 'ราคาออก', 'Result': 'ผลลัพธ์',
    'Reason': 'สาเหตุ', 'Closed': 'ปิดแล้ว', 'Placed': 'สั่งเมื่อ', 'Time': 'เวลา', 'Type': 'ประเภท', 'Amount': 'จำนวน',
    'Balance after': 'ยอดคงเหลือหลังรายการ', 'Status': 'สถานะ', 'Note': 'หมายเหตุ', 'Price': 'ราคา', '24h': '24 ชม.',
    'Fee rate': 'ค่าธรรมเนียม', 'Close': 'ปิด', 'Cancel': 'ยกเลิก', 'Opened': 'เปิดเมื่อ', 'Exit / Mark': 'ราคาออก / ปัจจุบัน',
    'No open positions': 'ไม่มีโพซิชันที่เปิดอยู่', 'No pending limit orders': 'ไม่มีคำสั่งลิมิตที่รออยู่',
    'No closed trades yet': 'ยังไม่มีการเทรดที่ปิดแล้ว', 'No transactions': 'ไม่มีธุรกรรม',
    'Order cancelled': 'ยกเลิกคำสั่งแล้ว',
    // markets / portfolio / wallet
    'Max leverage': 'เลเวอเรจสูงสุด', 'Equity': 'มูลค่าพอร์ต', 'Balance + margin + open PnL': 'ยอดเงิน + มาร์จิ้น + กำไร/ขาดทุนที่ยังไม่ปิด',
    'Available balance': 'ยอดเงินที่ใช้ได้', 'Open PnL': 'กำไร/ขาดทุนที่ยังไม่ปิด', 'Realized PnL (net of fees)': 'กำไร/ขาดทุนที่ปิดแล้ว (หลังหักค่าธรรมเนียม)',
    'Win rate': 'อัตราชนะ', 'Trade history': 'ประวัติการเทรด', 'Balance': 'ยอดเงิน',
    'Deposits are credited after an administrator approves them. Withdrawals are held from your balance until processed.':
      'เงินฝากจะเข้าบัญชีหลังผู้ดูแลระบบอนุมัติ ส่วนการถอนจะกันยอดเงินไว้จนกว่าจะดำเนินการเสร็จ',
    'Deposit': 'ฝากเงิน', 'Withdraw': 'ถอนเงิน', 'Amount (USDT)': 'จำนวน (USDT)', 'Note (optional)': 'หมายเหตุ (ไม่บังคับ)',
    'e.g. bank transfer ref': 'เช่น เลขอ้างอิงการโอน', 'Request deposit': 'ขอฝากเงิน', 'Request withdrawal': 'ขอถอนเงิน',
    'Deposit requested — pending admin approval': 'ส่งคำขอฝากเงินแล้ว — รอผู้ดูแลอนุมัติ',
    'Withdrawal requested — funds on hold until processed': 'ส่งคำขอถอนเงินแล้ว — กันยอดเงินไว้จนกว่าจะดำเนินการ',
    'Take profit hit': 'ถึงจุดทำกำไร', 'Stop loss hit': 'ถึงจุดตัดขาดทุน', 'Liquidated': 'ถูกบังคับปิด', 'Closed by admin': 'ปิดโดยผู้ดูแลระบบ',

    // ---------- badges / enum values ----------
    'long': 'Long', 'short': 'Short', 'win': 'ชนะ', 'lose': 'แพ้', 'even': 'เสมอ', 'open': 'เปิดอยู่', 'pending': 'รอดำเนินการ',
    'closed': 'ปิดแล้ว', 'cancelled': 'ยกเลิกแล้ว', 'completed': 'สำเร็จ', 'rejected': 'ปฏิเสธ', 'active': 'ใช้งาน',
    'suspended': 'ระงับ', 'admin': 'แอดมิน', 'customer': 'ลูกค้า', 'manual': 'ปิดเอง', 'tp': 'TP', 'sl': 'SL',
    'liquidation': 'บังคับปิด', 'deposit': 'ฝากเงิน', 'withdrawal': 'ถอนเงิน', 'bonus': 'โบนัส', 'adjustment': 'ปรับยอด',
    'trade margin': 'มาร์จิ้นเทรด', 'trade fee': 'ค่าธรรมเนียมเทรด', 'trade settle': 'ชำระผลเทรด', 'order refund': 'คืนเงินคำสั่ง',
    'market': 'ตลาด', 'limit': 'ลิมิต', 'live': 'สด', 'lmt': 'ลิมิต', '—': '—',

    // ---------- admin ----------
    'Auto-refreshes every 10s': 'รีเฟรชอัตโนมัติทุก 10 วินาที', 'Customer balances': 'ยอดเงินลูกค้า', 'Open positions': 'โพซิชันที่เปิดอยู่',
    'Unrealized customer PnL': 'กำไร/ขาดทุนลูกค้าที่ยังไม่ปิด', 'live, marked to market': 'สด ตามราคาตลาด',
    'Closed trades': 'การเทรดที่ปิดแล้ว', 'Customer win rate': 'อัตราชนะของลูกค้า', 'Realized customer PnL': 'กำไร/ขาดทุนลูกค้าที่ปิดแล้ว',
    'before fees': 'ก่อนหักค่าธรรมเนียม', 'Fees collected': 'ค่าธรรมเนียมที่ได้รับ', 'House result': 'ผลประกอบการของระบบ',
    'fees − customer PnL (incl. open)': 'ค่าธรรมเนียม − กำไร/ขาดทุนลูกค้า (รวมที่ยังไม่ปิด)', 'Trading volume': 'ปริมาณการเทรด',
    'notional, all time': 'มูลค่ารวม ทั้งหมด', 'By market': 'แยกตามตลาด', 'Trades': 'จำนวนเทรด', 'Volume': 'ปริมาณ',
    'Win / Lose': 'ชนะ / แพ้', 'Customer PnL': 'กำไร/ขาดทุนลูกค้า', 'Latest closed trades': 'การเทรดที่ปิดล่าสุด',
    'Customer': 'ลูกค้า', 'Approve': 'อนุมัติ', 'Reject': 'ปฏิเสธ', 'Force close': 'บังคับปิด',
    'Google Sheets:': 'Google Sheets:', 'not configured': 'ยังไม่ได้ตั้งค่า', 'error': 'ผิดพลาด', 'waiting…': 'กำลังรอ…',
    'Sync now': 'ซิงค์ตอนนี้', 'Google Sheet updated': 'อัปเดต Google Sheet แล้ว',
    '+ New market': '+ เพิ่มตลาด', 'New market': 'เพิ่มตลาด',
    'Volatility is the per-second standard deviation of price moves; drift biases the trend (positive = up). Changing the price moves the live market instantly.':
      'ความผันผวนคือส่วนเบี่ยงเบนมาตรฐานของการเปลี่ยนแปลงราคาต่อวินาที ส่วนแนวโน้ม (drift) กำหนดทิศทางราคา (ค่าบวก = ขึ้น) การเปลี่ยนราคาจะมีผลกับตลาดทันที',
    'Volatility': 'ความผันผวน', 'Drift': 'แนวโน้ม', 'Max lev.': 'เลเวอเรจสูงสุด', 'Min margin': 'มาร์จิ้นขั้นต่ำ',
    'Edit': 'แก้ไข', 'Enable': 'เปิดใช้งาน', 'Disable': 'ปิดใช้งาน',
    'Symbol (BASE/QUOTE)': 'สัญลักษณ์ (BASE/QUOTE)', 'Display name': 'ชื่อที่แสดง', 'Starting price': 'ราคาเริ่มต้น',
    'Price (set to move market)': 'ราคา (ตั้งเพื่อขยับตลาด)', 'Price decimals': 'ทศนิยมของราคา',
    'Volatility (per second)': 'ความผันผวน (ต่อวินาที)', 'Drift / trend (per second)': 'แนวโน้ม (ต่อวินาที)',
    'Fee rate (0.0005 = 0.05%)': 'อัตราค่าธรรมเนียม (0.0005 = 0.05%)', 'Minimum margin (USDT)': 'มาร์จิ้นขั้นต่ำ (USDT)',
    'Enabled for trading': 'เปิดให้เทรด', 'Save changes': 'บันทึกการเปลี่ยนแปลง', 'Create market': 'สร้างตลาด',
    'Market created': 'สร้างตลาดแล้ว', 'Market updated': 'อัปเดตตลาดแล้ว',
    'Search name or email…': 'ค้นหาชื่อหรืออีเมล…', 'All roles': 'ทุกบทบาท', 'Admins': 'ผู้ดูแลระบบ', 'Any status': 'ทุกสถานะ',
    'Active': 'ใช้งาน', 'Suspended': 'ระงับ', '+ Add customer': '+ เพิ่มลูกค้า', 'Add customer': 'เพิ่มลูกค้า',
    'Temporary password': 'รหัสผ่านชั่วคราว', 'Create': 'สร้าง', 'Name': 'ชื่อ', 'Total PnL': 'กำไร/ขาดทุนรวม', 'Open': 'เปิดอยู่',
    'Joined': 'สมัครเมื่อ', 'Last login': 'เข้าระบบล่าสุด', 'No customers found': 'ไม่พบลูกค้า',
    'Wins': 'ชนะ', 'Losses': 'แพ้', 'Profile': 'โปรไฟล์', 'Role': 'บทบาท', 'New password (leave blank to keep)': 'รหัสผ่านใหม่ (เว้นว่างเพื่อใช้รหัสเดิม)',
    'Save profile': 'บันทึกโปรไฟล์', 'Adjust balance': 'ปรับยอดเงิน',
    'Positive to credit, negative to debit. Recorded as an "adjustment" transaction.': 'ค่าบวกเพื่อเพิ่ม ค่าลบเพื่อหัก บันทึกเป็นธุรกรรม "ปรับยอด"',
    'e.g. 500 or -200': 'เช่น 500 หรือ -200', 'Bonus, correction, …': 'โบนัส, แก้ไขยอด, …', 'Apply adjustment': 'ปรับยอด',
    'Profile saved': 'บันทึกโปรไฟล์แล้ว', 'Balance adjusted': 'ปรับยอดเงินแล้ว',
    'All types': 'ทุกประเภท', 'Withdrawal': 'ถอนเงิน', 'Adjustment': 'ปรับยอด', 'Bonus': 'โบนัส', 'Trade margin': 'มาร์จิ้นเทรด',
    'Trade fee': 'ค่าธรรมเนียมเทรด', 'Trade settlement': 'ชำระผลเทรด', 'Order refund': 'คืนเงินคำสั่ง', 'Pending': 'รอดำเนินการ',
    'Completed': 'สำเร็จ', 'Rejected': 'ปฏิเสธ', 'No transactions match': 'ไม่พบธุรกรรม',
    'Orders & positions': 'คำสั่งและโพซิชัน', 'Pending limit': 'ลิมิตที่รออยู่',
    'Cancelled': 'ยกเลิกแล้ว', 'Win & lose': 'ชนะและแพ้', 'Win only': 'เฉพาะชนะ', 'Lose only': 'เฉพาะแพ้', 'Break-even': 'เสมอทุน',
    'All markets': 'ทุกตลาด', 'Long & short': 'Long และ Short', 'Long': 'Long', 'Short': 'Short', 'No orders match': 'ไม่พบคำสั่ง',
    'Order cancelled and refunded': 'ยกเลิกคำสั่งและคืนเงินแล้ว', 'Close position': 'ปิดโพซิชัน',
    'It will be settled at the current market price.': 'จะชำระตามราคาตลาดปัจจุบัน',
    'Deposits are credited to the customer balance. Withdrawals are marked as paid out.': 'เงินฝากจะเข้ายอดเงินลูกค้า ส่วนการถอนจะถูกบันทึกว่าจ่ายแล้ว',
    'Deposits are discarded. Withdrawals are refunded to the customer balance.': 'เงินฝากจะถูกยกเลิก ส่วนการถอนจะคืนเงินเข้ายอดลูกค้า',
    'Confirm': 'ยืนยัน',

    // ---------- server messages ----------
    'Please log in': 'กรุณาเข้าสู่ระบบ', 'Wrong email or password': 'อีเมลหรือรหัสผ่านไม่ถูกต้อง',
    'Too many attempts. Try again in a few minutes.': 'พยายามหลายครั้งเกินไป กรุณาลองใหม่ในอีกสักครู่',
    'Your account is suspended': 'บัญชีของคุณถูกระงับ', 'That email is already registered': 'อีเมลนี้ถูกใช้สมัครแล้ว',
    'Enter a valid email': 'กรุณาใส่อีเมลที่ถูกต้อง', 'Password must be at least 8 characters': 'รหัสผ่านต้องมีอย่างน้อย 8 ตัวอักษร',
    'Enter your name': 'กรุณาใส่ชื่อ', 'This market is currently closed': 'ตลาดนี้ปิดอยู่ในขณะนี้',
    'Margin is below the market minimum': 'มาร์จิ้นต่ำกว่าขั้นต่ำของตลาด', 'Leverage is outside the allowed range': 'เลเวอเรจอยู่นอกช่วงที่อนุญาต',
    'Enter a valid limit price': 'กรุณาใส่ราคาลิมิตที่ถูกต้อง',
    'Take profit must be above the entry price for a long': 'สำหรับ Long ราคาทำกำไรต้องสูงกว่าราคาเข้า',
    'Stop loss must be below the entry price for a long': 'สำหรับ Long ราคาตัดขาดทุนต้องต่ำกว่าราคาเข้า',
    'Take profit must be below the entry price for a short': 'สำหรับ Short ราคาทำกำไรต้องต่ำกว่าราคาเข้า',
    'Stop loss must be above the entry price for a short': 'สำหรับ Short ราคาตัดขาดทุนต้องสูงกว่าราคาเข้า',
    'Order not found': 'ไม่พบคำสั่ง', 'Position is already closed': 'โพซิชันนี้ปิดไปแล้ว', 'Order is no longer pending': 'คำสั่งนี้ไม่ได้รออยู่แล้ว',
    'Position not found or already closed': 'ไม่พบโพซิชันหรือปิดไปแล้ว', 'Enter a valid amount': 'กรุณาใส่จำนวนที่ถูกต้อง',
    'Transaction not found': 'ไม่พบธุรกรรม', 'Transaction was already processed': 'ธุรกรรมนี้ดำเนินการไปแล้ว', 'User not found': 'ไม่พบผู้ใช้',
    'Admin only': 'สำหรับผู้ดูแลระบบเท่านั้น', 'Database unavailable, try again shortly': 'ฐานข้อมูลไม่พร้อมใช้งาน กรุณาลองใหม่',
    'Server error': 'เซิร์ฟเวอร์ขัดข้อง', 'Database error': 'ฐานข้อมูลขัดข้อง', 'Invalid margin': 'มาร์จิ้นไม่ถูกต้อง',
    'Invalid leverage': 'เลเวอเรจไม่ถูกต้อง', 'Invalid amount': 'จำนวนไม่ถูกต้อง', 'Invalid take profit': 'ราคาทำกำไรไม่ถูกต้อง',
    'Invalid stop loss': 'ราคาตัดขาดทุนไม่ถูกต้อง', 'Invalid limit price': 'ราคาลิมิตไม่ถูกต้อง',
    'Enter a non-zero amount': 'กรุณาใส่จำนวนที่ไม่เป็นศูนย์', 'You cannot suspend or demote yourself': 'คุณไม่สามารถระงับหรือลดสิทธิ์ตัวเองได้',
    'Symbol must look like BTC/USDT': 'สัญลักษณ์ต้องอยู่ในรูปแบบ BTC/USDT', 'Market already exists': 'มีตลาดนี้อยู่แล้ว',
    'Starting price is required': 'ต้องระบุราคาเริ่มต้น', 'Nothing to update': 'ไม่มีอะไรให้อัปเดต',
    // price sources
    'Price source': 'แหล่งราคา', 'Simulated': 'จำลอง', 'Custom JSON URL': 'URL JSON กำหนดเอง',
    'Symbol on the exchange': 'สัญลักษณ์บนกระดานเทรด', 'URL that returns the price (JSON)': 'URL ที่ส่งคืนราคา (JSON)',
    'Path to the price in the JSON': 'ตำแหน่งของราคาใน JSON', 'Test source': 'ทดสอบแหล่งราคา', 'Live price': 'ราคาสด',
    'Any API that returns JSON with the price': 'API ใดก็ได้ที่ส่งคืน JSON พร้อมราคา', 'auto': 'อัตโนมัติ',
    'Choose a live price source to test': 'กรุณาเลือกแหล่งราคาสดเพื่อทดสอบ', 'Enter the URL that returns the price': 'กรุณาใส่ URL ที่ส่งคืนราคา',
    'Invalid source symbol': 'สัญลักษณ์แหล่งราคาไม่ถูกต้อง', 'Invalid source URL': 'URL แหล่งราคาไม่ถูกต้อง', 'Unknown price source': 'ไม่รู้จักแหล่งราคานี้',
    'Each market follows a real exchange (Binance, Bybit, OKX, Coinbase, Kraken or any JSON price API) or a simulation. For simulated markets, volatility is the per-second standard deviation of price moves and drift biases the trend (positive = up).':
      'แต่ละตลาดใช้ราคาจริงจากกระดานเทรด (Binance, Bybit, OKX, Coinbase, Kraken หรือ API ราคาแบบ JSON ใดก็ได้) หรือราคาจำลอง สำหรับตลาดจำลอง ความผันผวนคือส่วนเบี่ยงเบนมาตรฐานของการเปลี่ยนแปลงราคาต่อวินาที และแนวโน้ม (drift) กำหนดทิศทาง (ค่าบวก = ขึ้น)',
  };

  // Texts containing numbers or names.
  const TH_PATTERNS = [
    [/^(\d+) active$/, 'ใช้งาน $1 ราย'],
    [/^\+ (.+) in open margin$/, '+ $1 ในมาร์จิ้นที่เปิดอยู่'],
    [/^(\d+) pending limit orders$/, 'คำสั่งลิมิตที่รออยู่ $1 รายการ'],
    [/^(\d+) open position\(s\)$/, 'โพซิชันที่เปิดอยู่ $1 รายการ'],
    [/^(\d+) closed trades$/, 'การเทรดที่ปิดแล้ว $1 รายการ'],
    [/^(\d+) win$/, 'ชนะ $1'], [/^(\d+) lose$/, 'แพ้ $1'],
    [/^(\d+) orders$/, '$1 คำสั่ง'], [/^(\d+) orders ·$/, '$1 คำสั่ง ·'],
    [/^· customer PnL$/, '· กำไร/ขาดทุนลูกค้า'],
    [/^(\d+)x · (market|limit)$/, (m, l, t) => `${l}x · ${t === 'market' ? 'ตลาด' : 'ลิมิต'}`],
    [/^Pending requests \((\d+)\)$/, 'คำขอที่รอดำเนินการ ($1)'],
    [/^Orders \((\d+)\)$/, 'คำสั่งเทรด ($1)'], [/^Transactions \((\d+)\)$/, 'ธุรกรรม ($1)'],
    [/^up to (\d+)x$/, 'สูงสุด $1x'],
    [/^(.+) · up to (\d+)x$/, '$1 · สูงสุด $2x'],
    [/^Last (.+) price$/, 'ราคาล่าสุด $1'],
    [/^synced (.+)$/, 'ซิงค์แล้ว $1'],
    [/^(.+) · (market|limit) · (\d+)x · fee (.+)$/, (m, a, t, l, f) => `${a} · ${t === 'market' ? 'ตลาด' : 'ลิมิต'} · ${l}x · ค่าธรรมเนียม ${f}`],
    [/^(Long|Short) (.+) opened at (.+)$/, '$1 $2 เปิดที่ราคา $3'],
    [/^Limit order placed at (.+)$/, 'วางคำสั่งลิมิตที่ราคา $1'],
    [/^Limit order filled: (.+) at (.+)$/, 'คำสั่งลิมิตจับคู่แล้ว: $1 ที่ราคา $2'],
    [/^Closed (.+): (.+) USDT \((win|lose|even)\)$/, (m, s, p, r) => `ปิด ${s}: ${p} USDT (${TH[r]})`],
    [/^(Take profit hit|Stop loss hit|Liquidated|Closed by admin|Closed): (.+) USDT$/, (m, w, rest) => `${TH[w] || 'ปิด'}: ${rest} USDT`],
    [/^Closed #(\d+): (.+) \((win|lose|even)\)$/, (m, id, p, r) => `ปิด #${id}: ${p} (${TH[r]})`],
    [/^Transaction #(\d+) (approved|rejected)$/, (m, id, a) => `ธุรกรรม #${id} ${a === 'approved' ? 'อนุมัติแล้ว' : 'ปฏิเสธแล้ว'}`],
    [/^(Approve|Reject) transaction #(\d+)\?$/, (m, a, id) => `${a === 'Approve' ? 'อนุมัติ' : 'ปฏิเสธ'}ธุรกรรม #${id}?`],
    [/^Force close position #(\d+)\?$/, 'บังคับปิดโพซิชัน #$1?'],
    [/^(.+) (enabled|disabled)$/, (m, s, a) => `${s} ${a === 'enabled' ? 'เปิดใช้งานแล้ว' : 'ปิดใช้งานแล้ว'}`],
    [/^Customer (.+) created$/, 'สร้างลูกค้า $1 แล้ว'],
    [/^Edit (.+)$/, 'แก้ไข $1'],
    [/^joined (.+) · last login (.+)$/, 'สมัคร $1 · เข้าระบบล่าสุด $2'],
    [/^(.+) · #(\d+) · joined (.+) · last login (.+)$/, '$1 · #$2 · สมัคร $3 · เข้าระบบล่าสุด $4'],
    [/^Google Sheets: (.+)$/, 'Google Sheets: $1'],
    [/^Real 1-minute prices from (.+)$/, 'ราคาจริงราย 1 นาทีจาก $1'],
    [/^e\.g\. (.+)$/, 'เช่น $1'],
    [/^Live price unavailable: (.+)$/, 'ไม่สามารถดึงราคาสดได้: $1'],
    [/^Price comes from (.+); switch the source to Simulated to set it by hand$/, 'ราคามาจาก $1 — เปลี่ยนแหล่งราคาเป็น "จำลอง" หากต้องการตั้งราคาเอง'],
    [/^Enter the (.+) symbol, e\.g\. (.+)$/, 'กรุณาใส่สัญลักษณ์ของ $1 เช่น $2'],
  ];

  const KEY = 'tradev_lang';
  let lang = 'en';
  try { lang = localStorage.getItem(KEY) === 'th' ? 'th' : 'en'; } catch {}

  function tr(text) {
    if (lang !== 'th' || !text) return text;
    const lead = text.match(/^\s*/)[0], trail = text.match(/\s*$/)[0];
    const core = text.trim();
    if (!core || !/[A-Za-z]/.test(core)) return text;
    if (Object.prototype.hasOwnProperty.call(TH, core)) return lead + TH[core] + trail;
    for (const [re, rep] of TH_PATTERNS) if (re.test(core)) return lead + core.replace(re, rep) + trail;
    return text;
  }

  const ATTRS = ['placeholder', 'title', 'aria-label'];
  const SKIP = new Set(['SCRIPT', 'STYLE', 'TEXTAREA', 'CODE']);
  function translateNode(node) {
    if (node.nodeType === 3) {
      const p = node.parentNode;
      if (!p || SKIP.has(p.nodeName) || p.closest?.('[data-no-i18n]')) return;
      const orig = node.__en ?? node.nodeValue;
      const out = tr(orig);
      if (out !== orig) { node.__en = orig; if (node.nodeValue !== out) node.nodeValue = out; }
      return;
    }
    if (node.nodeType !== 1 || SKIP.has(node.nodeName) || node.hasAttribute('data-no-i18n')) return;
    for (const a of ATTRS) {
      if (!node.hasAttribute(a)) continue;
      const store = `__en_${a}`;
      const orig = node[store] ?? node.getAttribute(a);
      const out = tr(orig);
      if (out !== orig) { node[store] = orig; if (node.getAttribute(a) !== out) node.setAttribute(a, out); }
    }
    for (const c of node.childNodes) translateNode(c);
  }
  function restore(node) {
    if (node.nodeType === 3) { if (node.__en !== undefined) { node.nodeValue = node.__en; delete node.__en; } return; }
    if (node.nodeType !== 1) return;
    for (const a of ATTRS) { const s = `__en_${a}`; if (node[s] !== undefined) { node.setAttribute(a, node[s]); delete node[s]; } }
    for (const c of node.childNodes) restore(c);
  }

  let observer;
  function observe() {
    if (observer) return;
    observer = new MutationObserver((muts) => {
      if (lang !== 'th') return;
      for (const m of muts) {
        if (m.type === 'characterData') {
          // our own writes leave __en set and the value already translated
          if (m.target.__en !== undefined && m.target.nodeValue === tr(m.target.__en)) continue;
          delete m.target.__en;
          translateNode(m.target);
        } else if (m.type === 'attributes') translateNode(m.target);
        else m.addedNodes.forEach(translateNode);
      }
    });
    observer.observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ATTRS });
  }

  function apply() {
    document.documentElement.lang = lang;
    document.body.classList.toggle('lang-th', lang === 'th');
    if (lang === 'th') translateNode(document.body); else restore(document.body);
    document.querySelectorAll('[data-lang-switch] button').forEach((b) => b.classList.toggle('active', b.dataset.lang === lang));
  }

  function set(next) {
    lang = next === 'th' ? 'th' : 'en';
    try { localStorage.setItem(KEY, lang); } catch {}
    apply();
    window.dispatchEvent(new Event('tv:lang')); // pages re-render dates/numbers in the new locale
  }

  function mountSwitches() {
    document.querySelectorAll('[data-lang-switch]').forEach((el) => {
      if (el.dataset.ready) return;
      el.dataset.ready = '1';
      el.classList.add('seg', 'lang-seg');
      el.setAttribute('data-no-i18n', '');
      el.innerHTML = '<button type="button" data-lang="en">EN</button><button type="button" data-lang="th">ไทย</button>';
      el.querySelectorAll('button').forEach((b) => b.addEventListener('click', () => set(b.dataset.lang)));
    });
  }

  function init() { mountSwitches(); observe(); apply(); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();

  return { t: tr, set, get lang() { return lang; }, get locale() { return lang === 'th' ? 'th-TH' : undefined; } };
})();
window.I18N = I18N;
