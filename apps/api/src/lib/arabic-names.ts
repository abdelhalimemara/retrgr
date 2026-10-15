/**
 * Latin spellings of common Saudi first and family names, for an extra Meta match row.
 * Letter-by-letter transliteration doesn't work (Arabic omits short vowels: محمد → "mhmd"),
 * so only names in this dictionary get a variant. Keys are normalised (see key()).
 */
const FIRST: Record<string, string> = {
  محمد: 'mohammed', احمد: 'ahmed', عبدالله: 'abdullah', عبدالرحمن: 'abdulrahman', عبدالعزيز: 'abdulaziz', خالد: 'khalid',
  فهد: 'fahad', سعود: 'saud', سلطان: 'sultan', فيصل: 'faisal', ناصر: 'nasser', تركي: 'turki', بندر: 'bandar', ماجد: 'majed',
  سعد: 'saad', عمر: 'omar', علي: 'ali', يوسف: 'yousef', ابراهيم: 'ibrahim', عبدالمجيد: 'abdulmajeed', عبدالملك: 'abdulmalik',
  نايف: 'naif', مشعل: 'mishal', منصور: 'mansour', سلمان: 'salman', راشد: 'rashed', حمد: 'hamad', حسن: 'hassan', حسين: 'hussein',
  طلال: 'talal', وليد: 'waleed', ياسر: 'yasser', عادل: 'adel', مازن: 'mazen', هاني: 'hani', زياد: 'ziyad', رائد: 'raed',
  مساعد: 'musaed', عبدالاله: 'abdulelah', عبدالكريم: 'abdulkarim', مشاري: 'mishari', بدر: 'bader', نواف: 'nawaf', ريان: 'rayan',
  سارة: 'sara', ساره: 'sara', نورة: 'noura', نوره: 'noura', فاطمة: 'fatima', عائشة: 'aisha', مريم: 'maryam', هند: 'hind',
  ريم: 'reem', لمى: 'lama', دانة: 'dana', دانه: 'dana', شهد: 'shahad', رغد: 'raghad', جواهر: 'jawaher', العنود: 'alanoud',
  منيرة: 'munira', هيفاء: 'haifa', امل: 'amal', اسماء: 'asma', خلود: 'kholoud', ندى: 'nada', نوف: 'nouf', مها: 'maha',
  غادة: 'ghada', لطيفة: 'latifa', حصة: 'hessa', بشاير: 'bashayer', روان: 'rawan', لينا: 'lina', ليان: 'layan', جود: 'joud',
  رهف: 'rahaf', دلال: 'dalal', عبير: 'abeer', وعد: 'waad', الجوهرة: 'aljohara', منى: 'mona', هدى: 'huda', ياسمين: 'yasmin',
}

const FAMILY: Record<string, string> = {
  القحطاني: 'alqahtani', العتيبي: 'alotaibi', الشمري: 'alshammari', الدوسري: 'aldosari', الغامدي: 'alghamdi', الزهراني: 'alzahrani',
  المطيري: 'almutairi', الحربي: 'alharbi', العنزي: 'alanazi', الشهري: 'alshehri', السبيعي: 'alsubaie', الرشيدي: 'alrashidi',
  العمري: 'alomari', المالكي: 'almalki', الجهني: 'aljohani', البقمي: 'albuqami', الشهراني: 'alshahrani', الاحمري: 'alahmari',
  العسيري: 'alasiri', اليامي: 'alyami', الهاجري: 'alhajri', المري: 'almarri', السهلي: 'alsahli', الخالدي: 'alkhalidi',
  التميمي: 'altamimi', السديري: 'alsudairi', الراشد: 'alrashed', العثمان: 'alothman', السعيد: 'alsaeed', الشهيل: 'alshuhail',
  الفيفي: 'alfaifi', القرني: 'alqarni', البلوي: 'albalawi', العطوي: 'alatawi', الحارثي: 'alharthi',
  الثبيتي: 'althubaiti', الصاعدي: 'alsaedi', اللحياني: 'allihyani', المحمدي: 'almohammadi', العمودي: 'alamoudi',
}

/** Strips diacritics/tatweel, unifies alef/hamza forms and drops spaces ("عبد الله" → "عبدالله"). */
function key(name: string) {
  return name
    .normalize('NFKC')
    .replace(/[ً-ْـ]/g, '')
    .replace(/[أإآ]/g, 'ا')
    .replace(/\s+/g, '')
    .trim()
}

const isArabic = (s: string | null | undefined) => !!s && /[؀-ۿ]/.test(s)

/** Latin variant for an Arabic name if it's in the dictionary, else null. */
export function latinName(name: string | null | undefined, kind: 'first' | 'family'): string | null {
  if (!isArabic(name)) return null
  const k = key(name!)
  return (kind === 'first' ? FIRST : FAMILY)[k] ?? (kind === 'family' ? FAMILY[`ال${k.replace(/^ال/, '')}`] ?? null : null)
}
