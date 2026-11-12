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
    // bank accounts
    'Bank account': 'บัญชีธนาคาร', 'Add your bank account': 'เพิ่มบัญชีธนาคารของคุณ', 'Change bank account': 'เปลี่ยนบัญชีธนาคาร',
    'Required before you can deposit, withdraw or trade. Withdrawals are paid to this account.': 'ต้องเพิ่มก่อนจึงจะฝาก ถอน หรือเทรดได้ เงินที่ถอนจะโอนเข้าบัญชีนี้',
    'Bank name': 'ชื่อธนาคาร', 'Account holder name': 'ชื่อบัญชี', 'Account number': 'เลขที่บัญชี', 'Save bank account': 'บันทึกบัญชีธนาคาร',
    'Change': 'เปลี่ยน', 'Bank account saved': 'บันทึกบัญชีธนาคารแล้ว', 'Bank account removed': 'ลบบัญชีธนาคารแล้ว', 'Remove': 'ลบ',
    'Add your bank account first': 'กรุณาเพิ่มบัญชีธนาคารก่อน', 'Add a bank account to start trading': 'เพิ่มบัญชีธนาคารเพื่อเริ่มเทรด',
    'Add your bank account to start trading': 'เพิ่มบัญชีธนาคารของคุณเพื่อเริ่มเทรด', 'Enter the bank name': 'กรุณาใส่ชื่อธนาคาร',
    "Enter the account holder's name": 'กรุณาใส่ชื่อบัญชี', 'Enter a valid account number (6–34 letters or digits)': 'กรุณาใส่เลขที่บัญชีที่ถูกต้อง (6–34 ตัวอักษรหรือตัวเลข)',
    'Bank': 'ธนาคาร', 'No bank account': 'ไม่มีบัญชีธนาคาร', 'Remove bank account?': 'ลบบัญชีธนาคาร?',
    'The customer will not be able to deposit, withdraw or trade until they add one again.': 'ลูกค้าจะไม่สามารถฝาก ถอน หรือเทรดได้จนกว่าจะเพิ่มบัญชีใหม่',
    'Daylight mode': 'โหมดกลางวัน', 'Dark mode': 'โหมดกลางคืน',
    'Adjust': 'ปรับยอด', 'Apply adjustment': 'ปรับยอดเงิน', 'Note / reference': 'หมายเหตุ / เลขอ้างอิง', 'Deposit recorded': 'บันทึกการฝากแล้ว', 'Withdrawal recorded': 'บันทึกการถอนแล้ว',
    'Money the customer paid you (cash, bank transfer). Recorded as a completed deposit.': 'เงินที่ลูกค้าชำระให้คุณ (เงินสด โอนเงิน) บันทึกเป็นการฝากที่สำเร็จ',
    'Money you paid out to the customer. Recorded as a completed withdrawal to their bank account.': 'เงินที่คุณจ่ายให้ลูกค้า บันทึกเป็นการถอนเข้าบัญชีธนาคารของลูกค้าที่สำเร็จ',
    'Corrections and bonuses: positive to credit, negative to debit. Recorded as an "adjustment".': 'แก้ไขยอดและโบนัส: ค่าบวกเพื่อเพิ่ม ค่าลบเพื่อหัก บันทึกเป็น "การปรับยอด"',
    'Deposit received': 'ได้รับเงินฝากแล้ว', 'Demo accounts use virtual funds: use Reset or Adjust instead': 'บัญชีเดโมใช้เงินเสมือน: ใช้การรีเซ็ตหรือปรับยอดแทน',
    'Chart': 'กราฟ', 'Order': 'ส่งคำสั่ง', 'Profile': 'โปรไฟล์', 'Security': 'ความปลอดภัย',
    'Bank account': 'บัญชีธนาคาร', 'Name, phone, address': 'ชื่อ เบอร์โทร ที่อยู่', 'Withdrawal code, password': 'รหัสถอนเงิน รหัสผ่าน',
    'Where withdrawals are paid': 'บัญชีรับเงินถอน', 'Manage': 'จัดการ', 'Add a bank account': 'เพิ่มบัญชีธนาคาร',
    'Demo accounts have no password or withdrawal code. Open a real account to use them.': 'บัญชีเดโมไม่มีรหัสผ่านหรือรหัสถอนเงิน เปิดบัญชีจริงเพื่อใช้งาน',
    'Demo accounts cannot deposit or withdraw, so no bank account is needed.': 'บัญชีเดโมฝากหรือถอนเงินไม่ได้ จึงไม่ต้องใช้บัญชีธนาคาร',
    'All': 'ทั้งหมด', '24h high / low': 'สูงสุด / ต่ำสุด 24 ชม.', '24h': '24 ชม.', 'Market': 'ตลาด', 'Last 4h': '4 ชม. ล่าสุด', 'Price · 24h': 'ราคา · 24 ชม.',
    // home
    'Home': 'หน้าแรก', 'Welcome back': 'ยินดีต้อนรับกลับ', 'Good morning': 'สวัสดีตอนเช้า', 'Good afternoon': 'สวัสดีตอนบ่าย', 'Good evening': 'สวัสดีตอนเย็น',
    'Search markets': 'ค้นหาตลาด', 'Ranking list': 'อันดับ', 'All markets': 'ตลาดทั้งหมด', 'Gainers': 'ขึ้นมากสุด', 'Losers': 'ลงมากสุด', '24h Vol': 'วอลุ่ม 24 ชม.',
    'Withdraw': 'ถอนเงิน', 'History': 'ประวัติ', 'Support': 'ติดต่อเรา', 'Contact our team:': 'ติดต่อทีมงานของเรา:',
    'Support contact details have not been published yet.': 'ยังไม่ได้เผยแพร่ช่องทางติดต่อ', 'Close': 'ปิด', 'No markets found': 'ไม่พบตลาด', 'Vol': 'วอลุ่ม',
    'Announcement': 'ประกาศ', 'Practice with virtual funds': 'ฝึกเทรดด้วยเงินเสมือน', 'Nothing here is real money. Open a real account when you are ready.': 'ไม่ใช่เงินจริง เปิดบัญชีจริงเมื่อคุณพร้อม',
    'Add your bank account': 'เพิ่มบัญชีธนาคาร', 'Needed before you can deposit, withdraw or trade.': 'จำเป็นก่อนฝาก ถอน หรือเทรด',
    'Protect your withdrawals': 'ปกป้องการถอนเงินของคุณ', 'Set a 6-digit withdrawal code in Account.': 'ตั้งรหัสถอนเงิน 6 หลักที่หน้าบัญชี',
    'Deposit by bank transfer': 'ฝากเงินด้วยการโอนผ่านธนาคาร', 'Long or short with take-profit and stop-loss.': 'เปิด Long หรือ Short พร้อมทำกำไรและตัดขาดทุน',
    'Daylight or dark?': 'โหมดกลางวันหรือกลางคืน?', 'Switch the look any time with the sun / moon button.': 'สลับธีมได้ทุกเมื่อด้วยปุ่มพระอาทิตย์ / พระจันทร์',
    'Deposit USDT': 'ฝาก USDT', 'Bank transfer': 'โอนผ่านธนาคาร', 'Demo balance': 'ยอดเงินเดโม', 'Reset back to the starting amount': 'รีเซ็ตกลับเป็นยอดเริ่มต้น',
    'Total equity': 'มูลค่ารวม', 'Demo equity': 'มูลค่ารวม (เดโม)', 'Open PnL': 'กำไร/ขาดทุนที่เปิดอยู่', 'open position(s)': 'โพซิชันที่เปิดอยู่',
    // withdrawal code & review
    'Withdrawal code': 'รหัสถอนเงิน', 'New 6-digit code': 'รหัสใหม่ 6 หลัก', 'Repeat code': 'ยืนยันรหัส', "Account password (to confirm it's you)": 'รหัสผ่านบัญชี (เพื่อยืนยันตัวตน)',
    'Save code': 'บันทึกรหัส', 'Change code': 'เปลี่ยนรหัส', 'Withdrawal code saved': 'บันทึกรหัสถอนเงินแล้ว', 'Your code is set.': 'ตั้งรหัสแล้ว',
    'You need it for every withdrawal. Enter a new one below to change it.': 'ต้องใช้ทุกครั้งที่ถอนเงิน กรอกรหัสใหม่ด้านล่างเพื่อเปลี่ยน',
    'Set a 6-digit code. You will be asked for it every time you withdraw, so nobody else can take money out even if they get into your account.': 'ตั้งรหัส 6 หลัก ระบบจะขอรหัสนี้ทุกครั้งที่ถอนเงิน เพื่อไม่ให้ผู้อื่นถอนเงินได้แม้จะเข้าบัญชีของคุณได้',
    'Set a withdrawal code on the Account page first': 'ตั้งรหัสถอนเงินที่หน้าบัญชีก่อน', 'Set your withdrawal code first (Account page)': 'ตั้งรหัสถอนเงินก่อน (หน้าบัญชี)',
    'Wrong withdrawal code': 'รหัสถอนเงินไม่ถูกต้อง', 'Too many wrong codes. Try again in 15 minutes.': 'กรอกรหัสผิดหลายครั้ง ลองใหม่ใน 15 นาที',
    'The withdrawal code must be 6 digits': 'รหัสถอนเงินต้องเป็นตัวเลข 6 หลัก', 'The codes do not match': 'รหัสไม่ตรงกัน', 'Account password is wrong': 'รหัสผ่านบัญชีไม่ถูกต้อง',
    'Choose a less obvious code (not 111111 or 123456)': 'เลือกรหัสที่เดายาก (ไม่ใช่ 111111 หรือ 123456)',
    'Withdrawal code set': 'ตั้งรหัสถอนเงินแล้ว', 'Withdrawal code changed': 'เปลี่ยนรหัสถอนเงินแล้ว', 'Withdrawal code reset': 'รีเซ็ตรหัสถอนเงินแล้ว',
    'If this was not you, contact support right away.': 'หากไม่ใช่คุณ โปรดติดต่อฝ่ายบริการทันที',
    'An administrator reset your withdrawal code. Set a new one on the Account page before your next withdrawal.': 'ผู้ดูแลได้รีเซ็ตรหัสถอนเงินของคุณ โปรดตั้งรหัสใหม่ที่หน้าบัญชีก่อนถอนเงินครั้งถัดไป',
    'Set': 'ตั้งแล้ว', 'Not set': 'ยังไม่ตั้ง', 'Reset code': 'รีเซ็ตรหัส', 'Reset withdrawal code?': 'รีเซ็ตรหัสถอนเงิน?',
    'Require withdrawal code': 'ต้องใช้รหัสถอนเงิน', 'Customers set a 6-digit code and must enter it for every withdrawal': 'ลูกค้าตั้งรหัส 6 หลักและต้องกรอกทุกครั้งที่ถอนเงิน',
    'Deposit request': 'คำขอฝากเงิน', 'Withdrawal request': 'คำขอถอนเงิน', 'Customer': 'ลูกค้า', 'Requested': 'เวลาที่ขอ', 'Customer note': 'หมายเหตุลูกค้า',
    'Pay to': 'จ่ายเข้าบัญชี', 'Customer bank (check the transfer came from here)': 'บัญชีลูกค้า (ตรวจสอบว่าโอนมาจากบัญชีนี้)',
    'Approve only after the money has arrived in your account. Approving credits the customer balance.': 'อนุมัติเมื่อเงินเข้าบัญชีของคุณแล้วเท่านั้น การอนุมัติจะเพิ่มยอดเงินให้ลูกค้า',
    'Approve after you have paid the customer. Rejecting returns the amount to their balance.': 'อนุมัติหลังจากโอนเงินให้ลูกค้าแล้ว การปฏิเสธจะคืนเงินเข้ายอดคงเหลือของลูกค้า',
    'Reason / reference (rejection reasons are sent to the customer)': 'เหตุผล / เลขอ้างอิง (เหตุผลการปฏิเสธจะส่งถึงลูกค้า)', 'Admin:': 'ผู้ดูแล:',
    // account & phone login
    'Account': 'บัญชี', 'Personal information': 'ข้อมูลส่วนตัว', 'Phone number': 'เบอร์โทรศัพท์', 'Date of birth': 'วันเกิด', 'Country': 'ประเทศ', 'Address': 'ที่อยู่',
    'You can log in with your email or phone number. To change your email, contact support.': 'คุณเข้าสู่ระบบได้ด้วยอีเมลหรือเบอร์โทรศัพท์ หากต้องการเปลี่ยนอีเมล โปรดติดต่อฝ่ายบริการ',
    'Save changes': 'บันทึกการเปลี่ยนแปลง', 'Change password': 'เปลี่ยนรหัสผ่าน', 'Current password': 'รหัสผ่านปัจจุบัน', 'New password': 'รหัสผ่านใหม่',
    'Repeat new password': 'ยืนยันรหัสผ่านใหม่', 'Update password': 'อัปเดตรหัสผ่าน', 'Password updated': 'อัปเดตรหัสผ่านแล้ว', 'Profile saved': 'บันทึกโปรไฟล์แล้ว',
    'The new passwords do not match': 'รหัสผ่านใหม่ไม่ตรงกัน', 'Current password is wrong': 'รหัสผ่านปัจจุบันไม่ถูกต้อง',
    'Email or phone number': 'อีเมลหรือเบอร์โทรศัพท์', 'Phone number (optional, lets you log in with it)': 'เบอร์โทรศัพท์ (ไม่บังคับ ใช้เข้าสู่ระบบได้)',
    'Wrong phone number or password': 'เบอร์โทรศัพท์หรือรหัสผ่านไม่ถูกต้อง', 'That phone number is already registered': 'เบอร์โทรศัพท์นี้ถูกใช้ลงทะเบียนแล้ว',
    'Enter a valid phone number': 'กรอกเบอร์โทรศัพท์ให้ถูกต้อง', 'Enter a valid date of birth': 'กรอกวันเกิดให้ถูกต้อง', 'Create your account in seconds': 'สร้างบัญชีได้ในไม่กี่วินาที',
    'Phone': 'โทรศัพท์', 'Phone (login)': 'โทรศัพท์ (ใช้เข้าสู่ระบบ)', 'Phone (optional, can be used to log in)': 'โทรศัพท์ (ไม่บังคับ ใช้เข้าสู่ระบบได้)',
    'Internal note (only admins see this)': 'บันทึกภายใน (เห็นเฉพาะผู้ดูแล)', 'Search name, email or phone…': 'ค้นหาชื่อ อีเมล หรือเบอร์โทร…',
    // demo accounts
    'Try a demo account': 'ทดลองใช้บัญชีเดโม', 'or': 'หรือ', 'DEMO': 'เดโม', 'Demo': 'เดโม', 'Demo account': 'บัญชีเดโม',
    'virtual funds for practice. Nothing here is real money.': 'เงินเสมือนสำหรับฝึกเทรด ไม่ใช่เงินจริง',
    '· virtual funds for practice. Nothing here is real money.': '· เงินเสมือนสำหรับฝึกเทรด ไม่ใช่เงินจริง',
    'Open a real account': 'เปิดบัญชีจริง', 'Reset demo balance': 'รีเซ็ตยอดเงินเดโม', 'Demo balance reset': 'รีเซ็ตยอดเงินเดโมแล้ว',
    'Your balance is virtual money for practice. Deposits and withdrawals are only available on a real account.': 'ยอดเงินของคุณเป็นเงินเสมือนสำหรับฝึกเทรด การฝากและถอนใช้ได้เฉพาะบัญชีจริง',
    'Leave the demo account?': 'ออกจากบัญชีเดโม?', 'A demo account cannot be opened again after you log out. You can start a new one any time.': 'เมื่อออกจากระบบแล้วจะไม่สามารถเปิดบัญชีเดโมนี้ได้อีก คุณเริ่มบัญชีเดโมใหม่ได้ทุกเมื่อ',
    'Open a real account?': 'เปิดบัญชีจริง?', 'You will leave the demo account and create a real one. Demo balances and trades are not carried over.': 'คุณจะออกจากบัญชีเดโมและสร้างบัญชีจริง ยอดเงินและการเทรดในเดโมจะไม่ถูกโอนไป',
    'Continue': 'ดำเนินการต่อ', 'Reset': 'รีเซ็ต', 'Reset demo balance?': 'รีเซ็ตยอดเงินเดโม?', 'Demo trader': 'นักเทรดเดโม',
    'Real & demo': 'จริงและเดโม', 'Real accounts': 'บัญชีจริง', 'Demo accounts': 'บัญชีเดโม', 'Demo balance (virtual USDT)': 'ยอดเงินเดโม (USDT เสมือน)',
    'Visitors can try a practice account with virtual funds (no bank account, no deposits or withdrawals)': 'ผู้เยี่ยมชมทดลองบัญชีฝึกเทรดด้วยเงินเสมือนได้ (ไม่ต้องมีบัญชีธนาคาร ไม่มีการฝากถอน)',
    'Deposits and withdrawals are not available on a demo account': 'บัญชีเดโมไม่สามารถฝากหรือถอนเงินได้',
    'Close your positions and cancel open orders before resetting': 'ปิดโพซิชันและยกเลิกคำสั่งที่ค้างอยู่ก่อนรีเซ็ต',
    'Demo accounts are not available': 'ไม่เปิดให้ใช้บัญชีเดโม', 'Too many demo accounts. Try again in a few minutes.': 'สร้างบัญชีเดโมมากเกินไป ลองใหม่ในอีกไม่กี่นาที',
    // notifications
    'Notifications': 'การแจ้งเตือน', 'No notifications yet': 'ยังไม่มีการแจ้งเตือน', 'Everyone': 'ทุกคน',
    'Send a notification': 'ส่งการแจ้งเตือน', 'One customer': 'ลูกค้ารายเดียว', 'All customers': 'ลูกค้าทั้งหมด',
    'Customer email': 'อีเมลลูกค้า', 'Type': 'ประเภท', 'Information': 'ข้อมูล', 'Good news': 'ข่าวดี', 'Warning': 'คำเตือน', 'Important': 'สำคัญ',
    'Title': 'หัวข้อ', 'Message': 'ข้อความ', 'Send': 'ส่ง', 'Sent': 'ส่งแล้ว', 'Nothing sent yet': 'ยังไม่มีการส่ง', 'To': 'ถึง', 'automatic': 'อัตโนมัติ',
    'Customers see a red dot on the bell and a pop-up the next time the app checks (within a few seconds). Deposits, withdrawals and balance adjustments are notified automatically.':
      'ลูกค้าจะเห็นจุดสีแดงที่กระดิ่งและป๊อปอัปภายในไม่กี่วินาที การฝาก ถอน และการปรับยอดเงินจะแจ้งเตือนอัตโนมัติ',
    'Notification sent': 'ส่งการแจ้งเตือนแล้ว', 'Delete notification?': 'ลบการแจ้งเตือน?', 'Customers will no longer see it.': 'ลูกค้าจะไม่เห็นอีกต่อไป',
    'Send to all customers?': 'ส่งถึงลูกค้าทั้งหมด?', 'Deleted': 'ลบแล้ว', 'Delete': 'ลบ', 'Notify the customer': 'แจ้งเตือนลูกค้า', 'Send message': 'ส่งข้อความ',
    'Balance adjusted': 'ปรับยอดเงินแล้ว', 'Deposit approved': 'อนุมัติการฝากเงินแล้ว', 'Deposit rejected': 'ปฏิเสธการฝากเงิน',
    'Withdrawal completed': 'ถอนเงินสำเร็จ', 'Withdrawal rejected': 'ปฏิเสธการถอนเงิน', 'No customer with that email': 'ไม่พบลูกค้าที่ใช้อีเมลนี้',
    // system settings
    'Settings': 'ตั้งค่า', 'System settings': 'ตั้งค่าระบบ', 'General': 'ทั่วไป', 'Site name': 'ชื่อเว็บไซต์',
    'Announcement (shown to customers; leave empty to hide)': 'ประกาศ (แสดงให้ลูกค้าเห็น เว้นว่างเพื่อซ่อน)',
    'Support contact (LINE, Telegram, phone or email)': 'ช่องทางติดต่อ (LINE, Telegram, โทรศัพท์ หรืออีเมล)',
    'Access & trading': 'การเข้าใช้งานและการเทรด', 'Open registration': 'เปิดรับสมัคร', 'New customers can create accounts': 'ลูกค้าใหม่สามารถสร้างบัญชีได้',
    'Trading enabled': 'เปิดการเทรด', 'Turn off to pause new orders (customers can still close positions)': 'ปิดเพื่อหยุดรับคำสั่งใหม่ (ลูกค้ายังปิดโพซิชันได้)',
    'Require bank account': 'ต้องมีบัญชีธนาคาร', 'Customers must add a bank account before depositing, withdrawing or trading': 'ลูกค้าต้องเพิ่มบัญชีธนาคารก่อนฝาก ถอน หรือเทรด',
    'Welcome balance for new accounts (USDT)': 'ยอดเงินต้อนรับสำหรับบัญชีใหม่ (USDT)', 'Max open positions per customer (0 = no limit)': 'จำนวนโพซิชันสูงสุดต่อลูกค้า (0 = ไม่จำกัด)',
    'Deposits & withdrawals': 'ฝากและถอนเงิน', 'Deposits enabled': 'เปิดรับฝากเงิน', 'Withdrawals enabled': 'เปิดให้ถอนเงิน',
    'Minimum deposit (USDT)': 'ฝากขั้นต่ำ (USDT)', 'Maximum deposit (0 = no limit)': 'ฝากสูงสุด (0 = ไม่จำกัด)',
    'Minimum withdrawal (USDT)': 'ถอนขั้นต่ำ (USDT)', 'Maximum withdrawal (0 = no limit)': 'ถอนสูงสุด (0 = ไม่จำกัด)',
    'Company deposit account': 'บัญชีรับฝากของบริษัท', "Shown on the customer's deposit form as the account to transfer money to.": 'แสดงในหน้าฝากเงินของลูกค้าเป็นบัญชีที่ต้องโอนเงินเข้า',
    'Instructions for customers': 'คำแนะนำสำหรับลูกค้า', 'Use your account email as the transfer reference.': 'ใช้อีเมลบัญชีของคุณเป็นข้อความอ้างอิงการโอน',
    'System info': 'ข้อมูลระบบ', 'Database': 'ฐานข้อมูล', 'Service account': 'Service account', 'Server region': 'ภูมิภาคเซิร์ฟเวอร์',
    'Price updates saved every': 'บันทึกราคาทุก', 'Google Sheets sync': 'ซิงค์ Google Sheets', 'Cron secret set': 'ตั้งค่า Cron secret แล้ว',
    'Admin account': 'บัญชีผู้ดูแล', 'Version': 'เวอร์ชัน', 'These come from environment variables in Vercel.': 'ค่าเหล่านี้มาจาก Environment Variables ใน Vercel',
    'Save settings': 'บันทึกการตั้งค่า', 'Settings saved': 'บันทึกการตั้งค่าแล้ว',
    'Trading is paused': 'หยุดการเทรดชั่วคราว', 'Registration is closed': 'ปิดรับสมัครแล้ว', 'New registrations are currently closed.': 'ขณะนี้ปิดรับสมัครสมาชิกใหม่',
    'Deposits are currently disabled': 'ปิดรับฝากเงินชั่วคราว', 'Withdrawals are currently disabled': 'ปิดการถอนเงินชั่วคราว',
    'Transfer to': 'โอนเข้าบัญชี', 'Paid to': 'จ่ายเข้าบัญชี', 'Support:': 'ติดต่อ:', 'Withdrawals are paid to this account.': 'เงินที่ถอนจะโอนเข้าบัญชีนี้',
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
    [/^Updated (.+)$/, 'อัปเดต $1'],
    [/^Last saved (.+)$/, 'บันทึกล่าสุด $1'],
    [/^Trade (\S+) up to (\d+)x$/, 'เทรด $1 สูงสุด $2x'], [/^Trade (\S+)$/, 'เทรด $1'],
    [/^Up to (\d+)x · long or short$/, 'สูงสุด $1x · Long หรือ Short'],
    [/^Bank transfer · (.+)$/, 'โอนผ่านธนาคาร · $1'],
    [/^Send to (.+) and request a deposit\. Credited after approval\.$/, 'โอนเข้า $1 แล้วแจ้งฝากเงิน ยอดจะเข้าหลังอนุมัติ'],
    [/^(Deposit|Withdrawal) #(\d+) (approved|rejected)$/, (m, w, n, r) => `${w === 'Deposit' ? 'การฝาก' : 'การถอน'} #${n} ${r === 'approved' ? 'อนุมัติแล้ว' : 'ปฏิเสธแล้ว'}`],
    [/^(.+) USDT has been deposited to your balance\.(.*)$/, (m, v, r) => `ฝากเงิน ${v} USDT เข้ายอดคงเหลือของคุณแล้ว${r.replace(' Note:', ' หมายเหตุ:')}`],
    [/^(.+) USDT has been withdrawn from your balance\.(.*)$/, (m, v, r) => `ถอนเงิน ${v} USDT จากยอดคงเหลือของคุณแล้ว${r.replace(' Note:', ' หมายเหตุ:')}`],
    [/^(Deposit|Withdraw) (.+) USDT\?$/, (m, w, v) => `${w === 'Deposit' ? 'ฝาก' : 'ถอน'} ${v} USDT?`],
    [/^Practice with (.+) virtual USDT\. No sign-up needed\.$/, 'ฝึกเทรดด้วยเงินเสมือน $1 USDT ไม่ต้องสมัคร'],
    [/^Your virtual balance goes back to (.+) USDT\.$/, 'ยอดเงินเสมือนจะกลับเป็น $1 USDT'],
    [/^(\d+) active · (\d+) demo$/, 'ใช้งาน $1 · เดโม $2'],
    [/^Your deposit of (.+) USDT has been credited to your balance\.$/, 'ยอดฝาก $1 USDT เข้าบัญชีของคุณแล้ว'],
    [/^Your deposit request of (.+) USDT was rejected\.(.*)$/, (m, v, r) => `คำขอฝากเงิน ${v} USDT ถูกปฏิเสธ${r.replace(' Note:', ' หมายเหตุ:')}`],
    [/^(.+) USDT has been sent to your bank account\.$/, 'โอน $1 USDT เข้าบัญชีธนาคารของคุณแล้ว'],
    [/^Your withdrawal of (.+) USDT was rejected and the amount returned to your balance\.(.*)$/, (m, v, r) => `คำขอถอน ${v} USDT ถูกปฏิเสธและคืนเงินเข้ายอดคงเหลือแล้ว${r.replace(' Note:', ' หมายเหตุ:')}`],
    [/^Your balance was (credited|debited) (.+) USDT\.(.*)$/, (m, w, v, r) => `ยอดเงินของคุณถูก${w === 'credited' ? 'เพิ่ม' : 'หัก'} ${v} USDT${r.replace(' Note:', ' หมายเหตุ:')}`],
    [/^"(.+)" will be shown to every customer\.$/, '"$1" จะแสดงให้ลูกค้าทุกคนเห็น'],
    [/^every (\d+) s$/, 'ทุก $1 วินาที'], [/^(\d+) s$/, '$1 วินาที'],
    [/^(min [\d,.]+)?( · )?(max [\d,.]+)? USDT$/, (m) => m.replace('min', 'ขั้นต่ำ').replace('max', 'สูงสุด')],
    [/^Minimum (deposit|withdrawal) is (.+) USDT$/, (m, w, v) => `${w === 'deposit' ? 'ฝาก' : 'ถอน'}ขั้นต่ำ ${v} USDT`],
    [/^Maximum (deposit|withdrawal) is (.+) USDT$/, (m, w, v) => `${w === 'deposit' ? 'ฝาก' : 'ถอน'}สูงสุด ${v} USDT`],
    [/^You can have at most (\d+) open positions and orders$/, 'เปิดโพซิชันและคำสั่งได้สูงสุด $1 รายการ'],
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
