// Firebase configuration
const firebaseConfig = {
  apiKey: "AIzaSyAqOKcGoRLo-qcLmFOJgh_TOzwExkZeVVg",
  authDomain: "mapa-trillas-bare.firebaseapp.com",
  projectId: "mapa-trillas-bare",
  storageBucket: "mapa-trillas-bare.firebasestorage.app",
  messagingSenderId: "836434447060",
  appId: "1:836434447060:web:b5451aa44ec8af8a590941"
};

// Initialize Firebase
firebase.initializeApp(firebaseConfig);
const db = firebase.firestore();

// Habilitar persistencia offline para Firestore
db.enablePersistence().catch(err => {
    console.log('Error habilitando persistencia offline:', err);
});

window.db = db;