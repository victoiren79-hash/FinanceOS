// =============================================
// FinanceOS — script.js
// =============================================

// ── 1. SUPABASE ───────────────────────────────────────────────
const SUPABASE_URL      = 'https://kgiuawtfylvxxozscddw.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_ZIr0GzpK6O5R2ow4Y_evUg__8BrJxdI';

const { createClient } = supabase;
const db = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// ── 2. STATE ──────────────────────────────────────────────────
let currentUser  = null;
let members      = [];
let transactions = [];

// ── 3. AUTH ───────────────────────────────────────────────────
let isLogin = true;

document.getElementById('toggle-btn').addEventListener('click', () => {
    isLogin = !isLogin;
    document.getElementById('auth-btn').textContent   = isLogin ? 'Login'   : 'Sign Up';
    document.getElementById('toggle-btn').textContent = isLogin ? 'New here? Sign Up' : 'Already have account? Login';
});

document.getElementById('auth-btn').addEventListener('click', async () => {
    const email    = document.getElementById('email').value.trim();
    const password = document.getElementById('password').value.trim();
    if (!email || !password) return alert('Please enter email and password.');

    const btn = document.getElementById('auth-btn');
    btn.textContent = 'Please wait…';
    btn.disabled    = true;

    try {
        const result = isLogin
            ? await db.auth.signInWithPassword({ email, password })
            : await db.auth.signUp({ email, password });

        if (result.error) throw result.error;

        if (!isLogin && result.data?.user && !result.data.session) {
            alert('Account created! Check your email to confirm, then log in.');
            isLogin = true;
            document.getElementById('auth-btn').textContent   = 'Login';
            document.getElementById('toggle-btn').textContent = 'New here? Sign Up';
        }
    } catch (err) {
        alert('Auth error: ' + err.message);
    } finally {
        btn.textContent = isLogin ? 'Login' : 'Sign Up';
        btn.disabled    = false;
    }
});

db.auth.onAuthStateChange((_event, session) => {
    if (session?.user) { currentUser = session.user; onLogin(); }
    else               { currentUser = null;          onLogout(); }
});

document.getElementById('logout-btn').addEventListener('click', () => db.auth.signOut());

function onLogin() {
    document.getElementById('auth-screen').classList.add('hidden');
    document.getElementById('sidebar').classList.remove('hidden');
    document.getElementById('main-app').classList.remove('hidden');
    const email = currentUser.email;
    document.getElementById('user-name').textContent = email;
    // Set avatar initial
    const avatar = document.querySelector('.w-8.h-8.rounded-full');
    if (avatar) avatar.textContent = email[0].toUpperCase();
    loadAll();
}

function onLogout() {
    document.getElementById('auth-screen').classList.remove('hidden');
    document.getElementById('sidebar').classList.add('hidden');
    document.getElementById('main-app').classList.add('hidden');
}

// ── 4. DATA ───────────────────────────────────────────────────
async function loadAll() {
    const { data: mData, error: mErr } = await db.from('members').select('*').order('name');
    if (mErr) { console.error(mErr); return; }
    members = mData || [];

    const { data: tData, error: tErr } = await db.from('transactions').select('*').order('created_at', { ascending: false });
    if (tErr) { console.error(tErr); return; }
    transactions = tData || [];

    renderAll();
}

// ── 5. MEMBERS ────────────────────────────────────────────────
async function saveMember() {
    const name = document.getElementById('m-name').value.trim();
    if (!name) return alert('Please enter a name.');

    const { data, error } = await db.from('members').insert([{ name }]).select().single();
    if (error) { alert('Error: ' + error.message); return; }

    members.push(data);
    members.sort((a, b) => a.name.localeCompare(b.name));
    document.getElementById('m-name').value = '';
    closeModal('member-modal');
    renderAll();
}

async function deleteMember(id, name) {
    if (!confirm(`Remove "${name}" from the group? This also deletes all their transactions.`)) return;
    const { error } = await db.from('members').delete().eq('id', id);
    if (error) { alert('Error: ' + error.message); return; }
    members      = members.filter(m => m.id !== id);
    transactions = transactions.filter(t => t.member_id !== id);
    renderAll();
}

// ── 6. TRANSACTIONS ───────────────────────────────────────────
let currentTransType = 'Deposit';

function openModal(modalId, type = null, preselectedMemberId = null) {
    document.getElementById(modalId).classList.remove('hidden');

    if (modalId === 'trans-modal' && type) {
        currentTransType = type;
        document.getElementById('t-modal-title').textContent = type;

        const btn = document.getElementById('t-save-btn');
        btn.textContent = 'Confirm ' + type;
        btn.style.background =
            type === 'Deposit'        ? '#10b981' :
            type === 'Loan Issue'     ? '#0f172a' : '#f59e0b';

        const sel = document.getElementById('t-member-select');
        sel.innerHTML = members.length
            ? members.map(m => `<option value="${m.id}">${m.name}</option>`).join('')
            : '<option disabled>No members yet</option>';
        if (preselectedMemberId) sel.value = preselectedMemberId;
    }
}

function closeModal(modalId) {
    document.getElementById(modalId).classList.add('hidden');
    if (modalId === 'trans-modal') document.getElementById('t-amount').value = '';
}

document.getElementById('t-save-btn').addEventListener('click', async () => {
    const memberId = document.getElementById('t-member-select').value;
    const amount   = parseFloat(document.getElementById('t-amount').value);

    if (!memberId) { alert('Please select a member.'); return; }
    if (!amount || amount <= 0) { alert('Please enter a valid amount.'); return; }

    if (currentTransType === 'Loan Issue') {
        const pool = calcPoolBalance();
        if (amount > pool) { alert(`Insufficient pool. Available: ${fmt(pool)}`); return; }
    }
    if (currentTransType === 'Loan Repayment') {
        const owed = memberOutstandingLoan(memberId);
        if (owed === 0) { alert('This member has no outstanding loan.'); return; }
        if (amount > owed) { alert(`Exceeds outstanding balance: ${fmt(owed)}`); return; }
    }

    const { data, error } = await db.from('transactions')
        .insert([{ member_id: memberId, type: currentTransType, amount }])
        .select().single();
    if (error) { alert('Error: ' + error.message); return; }

    transactions.unshift(data);
    closeModal('trans-modal');
    renderAll();
});

// Close modals on backdrop click
['member-modal', 'trans-modal'].forEach(id => {
    document.getElementById(id).addEventListener('click', e => {
        if (e.target === e.currentTarget) closeModal(id);
    });
});

// ── 7. CALCULATIONS ───────────────────────────────────────────
function memberBalance(memberId) {
    return transactions.filter(t => t.member_id === memberId).reduce((sum, t) => {
        if (t.type === 'Deposit')        return sum + t.amount;
        if (t.type === 'Loan Issue')     return sum - t.amount;
        if (t.type === 'Loan Repayment') return sum + t.amount;
        return sum;
    }, 0);
}

function memberOutstandingLoan(memberId) {
    const issued = transactions.filter(t => t.member_id === memberId && t.type === 'Loan Issue')    .reduce((s,t) => s + t.amount, 0);
    const repaid = transactions.filter(t => t.member_id === memberId && t.type === 'Loan Repayment').reduce((s,t) => s + t.amount, 0);
    return Math.max(0, issued - repaid);
}

function calcPoolBalance() {
    return transactions.reduce((sum, t) => {
        if (t.type === 'Deposit')        return sum + t.amount;
        if (t.type === 'Loan Issue')     return sum - t.amount;
        if (t.type === 'Loan Repayment') return sum + t.amount;
        return sum;
    }, 0);
}

function calcTotalOnLoan() {
    const issued = transactions.filter(t => t.type === 'Loan Issue')    .reduce((s,t) => s + t.amount, 0);
    const repaid = transactions.filter(t => t.type === 'Loan Repayment').reduce((s,t) => s + t.amount, 0);
    return Math.max(0, issued - repaid);
}

function calcGrossDeposits() {
    return transactions.filter(t => t.type === 'Deposit').reduce((s,t) => s + t.amount, 0);
}

function calcEstimatedInterest() { return calcTotalOnLoan() * 0.10; }

function fmt(n) {
    return 'RWF ' + Number(n).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
}

function fmtDate(iso) {
    return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

// ── 8. RENDER ─────────────────────────────────────────────────
function renderAll() {
    renderDashboard();
    renderMemberDirectory();
    renderLoanLedger();
    renderReports();
}

function renderDashboard() {
    document.getElementById('stat-pool').textContent     = fmt(calcPoolBalance());
    document.getElementById('stat-loan').textContent     = fmt(calcTotalOnLoan());
    document.getElementById('stat-interest').textContent = fmt(calcEstimatedInterest());
    document.getElementById('stat-count').textContent    = members.length;

    const memberMap = Object.fromEntries(members.map(m => [m.id, m.name]));
    const tbody = document.getElementById('ledger-rows');

    tbody.innerHTML = transactions.slice(0, 20).map(t => `
        <tr>
            <td class="font-semibold text-slate-800">${memberMap[t.member_id] || '—'}</td>
            <td>
                <span class="badge ${t.type === 'Deposit' ? 'badge-green' : t.type === 'Loan Issue' ? 'badge-blue' : 'badge-amber'}">
                    ${t.type}
                </span>
            </td>
            <td class="text-right font-bold ${t.type === 'Deposit' ? 'text-emerald-600' : t.type === 'Loan Issue' ? 'text-blue-600' : 'text-amber-600'}">
                ${t.type === 'Loan Issue' ? '−' : '+'}${fmt(t.amount)}
            </td>
            <td class="text-right text-slate-400 text-xs">${fmtDate(t.created_at)}</td>
        </tr>`).join('') ||
        `<tr><td colspan="4" class="text-center text-slate-400 text-xs py-10">No transactions yet.</td></tr>`;
}

function renderMemberDirectory() {
    const tbody = document.getElementById('member-directory-rows');
    tbody.innerHTML = members.map(m => {
        const bal         = memberBalance(m.id);
        const outstanding = memberOutstandingLoan(m.id);
        const hasLoan     = outstanding > 0;
        const safeName    = m.name.replace(/'/g, "\\'");
        return `
        <tr>
            <td>
                <div class="font-semibold text-slate-800">${m.name}</div>
                ${hasLoan ? `<div class="mt-1"><span class="badge badge-blue">Loan: ${fmt(outstanding)}</span></div>` : ''}
            </td>
            <td class="text-right font-bold ${bal >= 0 ? 'text-emerald-600' : 'text-red-500'}">${fmt(bal)}</td>
            <td class="text-right">
                <div style="display:flex;justify-content:flex-end;gap:6px;flex-wrap:wrap;">
                    ${hasLoan ? `<button onclick="openModal('trans-modal','Loan Repayment','${m.id}')"
                        style="padding:5px 10px;border-radius:8px;font-size:11px;font-weight:700;background:#fffbeb;color:#d97706;border:none;cursor:pointer;">
                        Repayment
                    </button>` : ''}
                    <button onclick="deleteMember('${m.id}','${safeName}')"
                        style="padding:5px 10px;border-radius:8px;font-size:11px;font-weight:700;background:#fef2f2;color:#dc2626;border:none;cursor:pointer;">
                        Remove
                    </button>
                </div>
            </td>
        </tr>`;
    }).join('') || `<tr><td colspan="3" class="text-center text-slate-400 text-xs py-10">No members yet.</td></tr>`;
}

function renderLoanLedger() {
    const memberMap = Object.fromEntries(members.map(m => [m.id, m.name]));
    const loans = transactions.filter(t => t.type === 'Loan Issue');
    const tbody = document.getElementById('loan-ledger-rows');
    tbody.innerHTML = loans.map(t => {
        const outstanding = memberOutstandingLoan(t.member_id);
        const cleared     = outstanding === 0;
        return `
        <tr>
            <td class="font-semibold text-slate-800">${memberMap[t.member_id] || '—'}</td>
            <td class="text-slate-400">${fmtDate(t.created_at)}</td>
            <td class="text-right font-bold text-blue-600">${fmt(t.amount)}</td>
            <td class="text-right">
                ${cleared
                    ? `<span class="badge badge-green">✓ Cleared</span>`
                    : `<span class="badge badge-red">Owing ${fmt(outstanding)}</span>`}
            </td>
        </tr>`;
    }).join('') || `<tr><td colspan="4" class="text-center text-slate-400 text-xs py-10">No loans issued yet.</td></tr>`;
}

function renderReports() {
    document.getElementById('report-savings').textContent = fmt(calcGrossDeposits());
    document.getElementById('report-loans').textContent   = fmt(calcTotalOnLoan());
}

// ── 9. NAVIGATION ─────────────────────────────────────────────
const pages   = { dashboard: 'page-dashboard', members: 'page-members', loans: 'page-loans', reports: 'page-reports' };
const navBtns = { dashboard: 'nav-dashboard',  members: 'nav-members',  loans: 'nav-loans',  reports: 'nav-reports' };
const titles  = { dashboard: 'Dashboard', members: 'Member Directory', loans: 'Loan Ledger', reports: 'Reports' };

function showPage(name) {
    Object.values(pages).forEach(id => document.getElementById(id).classList.add('hidden'));
    Object.values(navBtns).forEach(id => {
        const el = document.getElementById(id);
        el.classList.remove('active-nav');
        el.classList.add('text-white/50');
        el.classList.remove('text-white');
    });
    document.getElementById(pages[name]).classList.remove('hidden');
    const btn = document.getElementById(navBtns[name]);
    btn.classList.add('active-nav');
    btn.classList.remove('text-white/50');
    document.getElementById('header-title').textContent = titles[name];

    // Sync bottom nav
    document.querySelectorAll('.bottom-nav-btn').forEach(b => {
        b.classList.toggle('active', b.dataset.page === name);
    });
}

Object.keys(navBtns).forEach(name => {
    document.getElementById(navBtns[name]).addEventListener('click', () => { showPage(name); closeSidebar(); });
});

// ── 10. MOBILE ────────────────────────────────────────────────
document.getElementById('hamburger-btn').addEventListener('click', () => {
    document.getElementById('sidebar').classList.add('open');
    document.getElementById('sidebar-overlay').classList.add('open');
});

function closeSidebar() {
    document.getElementById('sidebar').classList.remove('open');
    document.getElementById('sidebar-overlay').classList.remove('open');
}

document.getElementById('sidebar-close').addEventListener('click', closeSidebar);
document.getElementById('sidebar-overlay').addEventListener('click', closeSidebar);

document.querySelectorAll('.bottom-nav-btn').forEach(btn => {
    btn.addEventListener('click', () => { showPage(btn.dataset.page); closeSidebar(); });
});