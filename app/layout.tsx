import type { Metadata } from 'next';
import './globals.css';
export const metadata:Metadata={title:'PricePilot AI | قیمت‌گذاری هوشمند',description:'کنترل قیمت، رقابت و سود فروشگاه شما'};
export default function RootLayout({children}:{children:React.ReactNode}){return <html lang="fa" dir="rtl"><body>{children}</body></html>;}
