import React from 'react';
import ReactDOM from 'react-dom/client';
import { HashRouter, Routes, Route } from 'react-router-dom';
import App from './App.jsx';
import RegistrationPortal from './components/RegistrationPortal.jsx';
import ErrorBoundary from './components/ErrorBoundary.jsx';
import { AuthProvider } from './context/AuthContext.jsx';
import './index.css';

ReactDOM.createRoot(document.getElementById('root')).render(
    <React.StrictMode>
        <HashRouter>
            <ErrorBoundary>
                <Routes>
                    <Route path="/register" element={<RegistrationPortal />} />
                    <Route path="*" element={<AuthProvider><App /></AuthProvider>} />
                </Routes>
            </ErrorBoundary>
        </HashRouter>
    </React.StrictMode>
);
