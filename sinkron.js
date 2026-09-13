import { initializeApp } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-app.js";
import { getAuth, signInWithPopup, GoogleAuthProvider, signOut, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js";
import { getFirestore, doc, onSnapshot, setDoc, getDoc } from "https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js";

// Konfigurasi Firebase Anda
const firebaseConfig = {
    apiKey: "AIzaSyCIyWxcTM03VQ97U90K0cQSK2uQ3SWn76w",
    authDomain: "quran-5185a.firebaseapp.com",
    projectId: "quran-5185a",
    storageBucket: "quran-5185a.firebasestorage.app",
    messagingSenderId: "750502218906",
    appId: "1:750502218906:web:906decd93e3e0d217e2323",
    measurementId: "G-C1ETED8R33"
};


// Inisialisasi Firebase & Services
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const provider = new GoogleAuthProvider();

const STORAGE_KEY = "quran_settings";
let currentUserId = null;
let unsubscribeSnapshot = null;
let localSettings = null;

// Elemen DOM
const txtUserInfo = document.getElementById('user-info');
const btnLogin = document.getElementById('btn-login');
const btnLogout = document.getElementById('btn-logout');
const sectSettings = document.getElementById('settings-section');
const chkDarkMode = document.getElementById('chk-dark-mode');
const selFontSize = document.getElementById('sel-font-size');
const txtSyncStatus = document.getElementById('sync-status');

// --- AMBIL DARI LOCALSTORAGE DI AWAL (Instant Load, Tanpa Nunggu Auth/Internet) ---
function loadInitialLocalData() {
    const rawData = localStorage.getItem(STORAGE_KEY);
    if (rawData) {
        localSettings = JSON.parse(rawData);
        applySettingsToUI(localSettings);
        sectSettings.classList.remove('hidden'); // Tampilkan setingan meskipun offline/belum login
    }
}
loadInitialLocalData();

// --- FUNGSI UPDATE UI ---
function applySettingsToUI(settings) {
    if (!settings) return;

    // Terapkan ke elemen input
    chkDarkMode.checked = settings.theme === 'dark';
    selFontSize.value = settings.fontSize || '20px';

    // Terapkan efek visual ke halaman web
    if (settings.theme === 'dark') {
        document.body.classList.add('dark-mode');
    } else {
        document.body.classList.remove('dark-mode');
    }
    document.body.style.fontSize = settings.fontSize || '20px';
}

// --- LOGIKA SIMPAN PERUBAHAN (Write-Local-First, Sync-Cloud-Later) ---
async function handleSettingsChange() {
    const updatedData = {
        theme: chkDarkMode.checked ? 'dark' : 'light',
        fontSize: selFontSize.value,
        lastUpdated: Date.now()
    };

    // 1. Update lokal instan
    localStorage.setItem(STORAGE_KEY, JSON.stringify(updatedData));
    localSettings = updatedData;
    applySettingsToUI(updatedData);
    txtSyncStatus.innerText = "Status: Tersimpan di Lokal";

    // 2. Kirim ke cloud jika user sudah login
    if (currentUserId) {
        try {
            const docRef = doc(db, "users", currentUserId, "config", "setelan");
            await setDoc(docRef, updatedData, { merge: true });
            txtSyncStatus.innerText = "Status: Tersinkronisasi dengan Cloud";
        } catch (error) {
            console.warn("Gagal sinkron cloud (Offline).", error);
            txtSyncStatus.innerText = "Status: Tersimpan Lokal (Menunggu Online)";
        }
    }
}

// Event Listener untuk Perubahan Input User
chkDarkMode.addEventListener('change', handleSettingsChange);
selFontSize.addEventListener('change', handleSettingsChange);


// --- LOGIKA SINKRONISASI REAL-TIME DENGAN FIRESTORE ---
function startCloudSync(userId) {
    if (unsubscribeSnapshot) unsubscribeSnapshot(); // Bersihkan listener lama jika ada

    const docRef = doc(db, "users", userId, "config", "setelan");

    unsubscribeSnapshot = onSnapshot(docRef, (snapshot) => {
        if (snapshot.exists()) {
            const cloudSettings = snapshot.data();

            // Bandingkan timestamp: Ambil yang paling baru
            if (!localSettings || cloudSettings.lastUpdated > localSettings.lastUpdated) {
                localStorage.setItem(STORAGE_KEY, JSON.stringify(cloudSettings));
                localSettings = cloudSettings;
                applySettingsToUI(cloudSettings);
                txtSyncStatus.innerText = "Status: Diperbarui dari Device Lain";
            }
            // Jika data lokal lebih baru daripada cloud (kasus habis offline lalu online lagi)
            else if (localSettings && cloudSettings.lastUpdated < localSettings.lastUpdated) {
                setDoc(docRef, localSettings, { merge: true });
                txtSyncStatus.innerText = "Status: Memperbarui Cloud...";
            }
        } else if (localSettings) {
            // Kasus user baru pertama kali login di device ini tapi lokal sudah ada data settings
            setDoc(docRef, localSettings, { merge: true });
        }
    });
}

// --- SISTEM OTENTIKASI (AUTH) ---
onAuthStateChanged(auth, (user) => {
    if (user) {
        currentUserId = user.uid;
        txtUserInfo.innerText = `Halo, ${user.displayName || user.email}`;
        btnLogin.classList.add('hidden');
        btnLogout.classList.remove('hidden');
        sectSettings.classList.remove('hidden');

        // Mulai sinkronisasi cloud setelah user sukses terverifikasi
        startCloudSync(user.uid);
    } else {
        currentUserId = null;
        txtUserInfo.innerText = "Anda belum login. Pengaturan hanya disimpan di browser ini.";
        btnLogin.classList.remove('hidden');
        btnLogout.classList.add('hidden');
        txtSyncStatus.innerText = "Status: Lokal (Login untuk cadangkan ke Cloud)";

        if (unsubscribeSnapshot) {
            unsubscribeSnapshot();
            unsubscribeSnapshot = null;
        }
    }
});

// Event Login & Logout
btnLogin.addEventListener('click', () => signInWithPopup(auth, provider).catch(console.error));
btnLogout.addEventListener('click', () => signOut(auth).catch(console.error));