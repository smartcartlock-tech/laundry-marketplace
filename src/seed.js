// זריעת דמו: מכבסות, מחירונים, חלונות, משתמשי דמו, שליחים, הזמנות לדוגמה.
const { q, pool } = require('./db');

const LAUNDRIES = [
 { slug:'achuza', name:'מכבסת האחוזה', letter:'א', color:'#0e7a8a', city:'תל אביב', address:'שדרות רוטשילד 40', phone:'03-5550101', services:['כביסה','ניקוי יבש','גיהוץ'], delivery_fee:15, min_order:50, rating:4.8, rc:212,
   items:[['שק כביסה (עד 8 ק״ג)',56,'bag','כביסה'],['חולצה — כביסה וקיפול',8,'item','כביסה'],['מכנסיים — כביסה וגיהוץ',12,'item','גיהוץ'],['חליפה — ניקוי יבש',45,'item','ניקוי יבש'],['שמיכת פוך — ניקוי',70,'item','ניקוי יבש']] },
 { slug:'express', name:'כביסה אקספרס', letter:'כ', color:'#c26a12', city:'תל אביב', address:'דיזנגוף 120', phone:'03-5550102', services:['כביסה','גיהוץ'], delivery_fee:12, min_order:40, rating:4.6, rc:98,
   items:[['שק כביסה (עד 8 ק״ג)',49,'bag','כביסה'],['חולצה — כביסה וקיפול',7,'item','כביסה'],['מכנסיים — כביסה וגיהוץ',11,'item','גיהוץ'],['שמיכה — כביסה',55,'item','כביסה']] },
 { slug:'mumchim', name:'ניקוי יבש המומחים', letter:'נ', color:'#3557c9', city:'רמת גן', address:'ביאליק 32', phone:'03-5550103', services:['ניקוי יבש'], delivery_fee:18, min_order:60, rating:4.9, rc:340,
   items:[['חליפה — ניקוי יבש',45,'item','ניקוי יבש'],['שמלה — ניקוי יבש',38,'item','ניקוי יבש'],['מעיל — ניקוי יבש',52,'item','ניקוי יבש'],['מפה — ניקוי יבש',25,'item','ניקוי יבש']] },
 { slug:'carmel', name:'מכבסת הכרמל', letter:'ה', color:'#178a4c', city:'חיפה', address:'הרצל 75', phone:'04-5550104', services:['כביסה','שטיחים'], delivery_fee:14, min_order:45, rating:4.7, rc:156,
   items:[['שק כביסה (עד 8 ק״ג)',52,'bag','כביסה'],['חולצה — כביסה וקיפול',8,'item','כביסה'],['שטיח קטן — ניקוי',60,'item','שטיחים']] },
];

async function run() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const uid = async (phone, name, role='customer') => {
      const { rows } = await client.query(
        `INSERT INTO users(phone, name, role) VALUES ($1,$2,$3)
         ON CONFLICT (phone) DO UPDATE SET name=EXCLUDED.name RETURNING id`, [phone, name, role]);
      return rows[0].id;
    };
    const adminId = await uid('+972500000001', 'מנהל פלטפורמה', 'admin');
    const customerId = await uid('+972500000002', 'לקוחה לדמו');
    const ownerId = await uid('+972500000003', 'בעל מכבסה לדמו');
    const courierUser1 = await uid('+972500000004', 'שליח מכבסה לדמו', 'courier');
    const courierUser2 = await uid('+972500000005', 'שליח פלטפורמה לדמו', 'courier');

    for (const L of LAUNDRIES) {
      const { rows: t } = await client.query(
        `INSERT INTO tenants(slug, name, letter, color, city, address, phone, services, delivery_fee, min_order, approved, rating, rating_count, hours)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,true,$11,$12,$13) ON CONFLICT (slug) DO NOTHING RETURNING id`,
        [L.slug, L.name, L.letter, L.color, L.city, L.address, L.phone || null, L.services, L.delivery_fee, L.min_order, L.rating, L.rc,
         JSON.stringify({ '0': [['08:00','20:00']], '1': [['08:00','20:00']], '2': [['08:00','20:00']], '3': [['08:00','20:00']], '4': [['08:00','20:00']], '5': [['08:00','13:00']], '6': [] })]);
      if (!t[0]) continue;
      const tid = t[0].id;
      let i = 0;
      for (const [n, p, u, c] of L.items) {
        await client.query('INSERT INTO price_items(tenant_id, name, price, unit, category, sort) VALUES ($1,$2,$3,$4,$5,$6)', [tid, n, p, u, c, i++]);
      }
      for (const wd of [0,1,2,3,4]) {
        await client.query(`INSERT INTO pickup_windows(tenant_id, weekday, start_time, end_time, capacity, kind) VALUES ($1,$2,'09:00','12:00',10,'pickup')`, [tid, wd]);
        await client.query(`INSERT INTO pickup_windows(tenant_id, weekday, start_time, end_time, capacity, kind) VALUES ($1,$2,'16:00','19:00',10,'delivery')`, [tid, wd]);
      }
    }
    const { rows: ach } = await client.query(`SELECT id FROM tenants WHERE slug='achuza'`);
    const achuza = ach[0].id;
    await client.query('INSERT INTO tenant_members(tenant_id, user_id, role) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING', [achuza, ownerId, 'owner']);
    const { rows: c1 } = await client.query(
      `INSERT INTO couriers(user_id, tenant_id, model, vehicle, areas, approved) VALUES ($1,$2,'private','אופנוע','{תל אביב}',true) RETURNING id`, [courierUser1, achuza]);
    await client.query(
      `INSERT INTO couriers(user_id, tenant_id, model, vehicle, areas, approved) VALUES ($1,NULL,'platform','רכב','{תל אביב,רמת גן,גבעתיים}',true)`, [courierUser2]);
    await client.query(
      `INSERT INTO reviews(tenant_id, user_id, rating, text) VALUES
       ($1,$2,5,'שירות מעולה, הכביסה חזרה ריחנית ומקופלת. האיסוף היה בזמן!'),
       ($1,$2,4,'מחיר הוגן ומהיר. ממליץ.') ON CONFLICT DO NOTHING`, [achuza, customerId]);
    await client.query(`UPDATE price_items SET subscription_eligible=true WHERE tenant_id=$1 AND name LIKE 'שק%'`, [achuza]);
    // E2: תוכניות מנוי דמו למכבסת האחוזה
    const PLANS = [
      ['מנוי בסיסי', 4, 8, 149, null, '4 שקים בחודש · איסוף והחזרה חינם'],
      ['מנוי משפחתי', 8, 8, 259, 45, '8 שקים בחודש · איסוף והחזרה חינם · גיהוץ חולצות מתנה'],
    ];
    let pi = 0;
    for (const [pn, bags, kg, price, extra, perks] of PLANS) {
      await client.query(
        `INSERT INTO subscription_plans(tenant_id, name, bags_per_month, kg_per_bag, price, extra_bag_price, perks, sort)
         SELECT $1,$2,$3,$4,$5,$6,$7,$8
         WHERE NOT EXISTS (SELECT 1 FROM subscription_plans WHERE tenant_id=$1 AND name=$2)`,
        [achuza, pn, bags, kg, price, extra, perks, pi++]);
    }
    await client.query(
      `INSERT INTO points_ledger(tenant_id, user_id, delta, reason) VALUES ($1,$2,42,'בונוס הצטרפות למועדון')`, [achuza, customerId]);
    await client.query('COMMIT');
    console.log('[seed] ok. demo users: admin +972500000001, customer +972500000002, owner +972500000003, couriers +972500000004/5');
    return { adminId, customerId, ownerId };
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally { client.release(); }
}

if (require.main === module) {
  const { migrate } = require('./db');
  migrate().then(run).then(() => pool.end()).catch(e => { console.error(e); process.exit(1); });
}
module.exports = { run };
