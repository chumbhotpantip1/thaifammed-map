# วิธีการเปิดใช้งานระบบ Realtime บน Google Drive

โฟลเดอร์ Google Drive: [ระบบสมาชิก](https://drive.google.com/drive/folders/1kG-hz2vQ1hwbw-vX2xs80PyZhAN9ARz6?usp=sharing)
Google Sheet Master DB: [ฐานข้อมูลสมาชิกแพทย์เวชศาสตร์ครอบครัว_MasterDB_2026](https://docs.google.com/spreadsheets/d/1PVM2qdbidgsFVCZhgLW160PD3rcN39Vrac75OH-tYFU/edit?usp=drive_link)

---

## ขั้นตอนการติดตั้งและเปิดใช้งาน Realtime Web App บน Google Drive (ใช้เวลา 2 นาที):

1. เปิดโฟลเดอร์ **[ระบบสมาชิก บน Google Drive](https://drive.google.com/drive/folders/1kG-hz2vQ1hwbw-vX2xs80PyZhAN9ARz6?usp=sharing)**
2. คลิกปุ่ม **"+ ใหม่" (+ New)** ที่มุมบนซ้าย -> เลือก **"เพิ่มเติม" (More)** -> เลือก **"Google Apps Script"**
   *(หากไม่เห็น ให้คลิก "+ เชื่อมต่อแอปเพิ่มเติม" แล้วค้นหา "Google Apps Script")*
3. ตั้งชื่อโปรเจกต์ว่า: `ระบบสมาชิกและแผนที่แพทย์เวชศาสตร์ครอบครัว`
4. ลบโค้ดเดิมในไฟล์ `Code.gs` แล้วนำโค้ดจากไฟล์ `Code.gs` ในโฟลเดอร์นี้ไปวางแทนที่ทั้งหมด (เชื่อมโยงกับ Master DB ID: `1PVM2qdbidgsFVCZhgLW160PD3rcN39Vrac75OH-tYFU`)
5. คลิกปุ่ม **"+" ข้างเมนู "ไฟล์" (Files)** -> เลือก **"HTML"** -> ตั้งชื่อไฟล์ว่า `index` (ไม่ต้องใส่นามสกุล .html)
6. คัดลอกเนื้อหาจากไฟล์ `index.html` ในโฟลเดอร์ `google_apps_script` ไปวางแทนที่ในไฟล์ `index.html` แล้วกดปุ่ม **บันทึก (Save)**
7. คลิกปุ่มสีน้ำเงิน **"ทำให้ใช้งานได้" (Deploy)** ที่มุมบนขวา -> เลือก **"การทำให้ใช้งานได้รายการใหม่" (New deployment)**
   - เลือกประเภท (Select type): **เว็บแอป (Web app)**
   - คำอธิบาย (Description): `Medical Member Realtime Dashboard Master DB`
   - เรียกใช้เป็น (Execute as): **ฉัน (Me - บัญชีของคุณ)**
   - ผู้มีสิทธิ์เข้าถึง (Who has access): **ทุกคน (Anyone)** หรือ บุคคลในองค์กร
8. คลิก **"ทำให้ใช้งานได้" (Deploy)** แล้วให้สิทธิ์การเข้าถึง (Authorize Access)
9. ท่านจะได้รับ **URL ของเว็บแอป (Web App URL)** เช่น:
   `https://script.google.com/macros/s/AKfycb.../exec`
10. เปิด URL นั้นผ่านเบราว์เซอร์ Chrome ได้ทันที! ระบบจะทำงานบนคลาวด์ของ Google Drive แบบ Realtime 100% เชื่อมโยงกับ Google Sheet Master DB อัตโนมัติ โดยไม่ต้องเปิดคอมพิวเตอร์ทิ้งไว้!

