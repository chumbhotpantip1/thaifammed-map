/**
 * =========================================================================
 * Medical Member Dashboard - Google Apps Script Backend (Realtime API)
 * ฐานข้อมูลหลัก: ฐานข้อมูลสมาชิกแพทย์เวชศาสตร์ครอบครัว_MasterDB_2026
 * Spreadsheet ID: 1PVM2qdbidgsFVCZhgLW160PD3rcN39Vrac75OH-tYFU
 * โฟลเดอร์ Google Drive: ระบบสมาชิก
 * URL: https://drive.google.com/drive/folders/1kG-hz2vQ1hwbw-vX2xs80PyZhAN9ARz6?usp=sharing
 * =========================================================================
 */

const SPREADSHEET_ID = '1PVM2qdbidgsFVCZhgLW160PD3rcN39Vrac75OH-tYFU';
const FALLBACK_SPREADSHEET_ID = '1AzFotDmKisar6OqrdPb-kIJewiPOGH7mx0O2Vc18Dxk';

function getActiveSpreadsheet() {
  try {
    return SpreadsheetApp.openById(SPREADSHEET_ID);
  } catch (e) {
    Logger.log('Could not open master spreadsheet ' + SPREADSHEET_ID + ', falling back: ' + e);
    return SpreadsheetApp.openById(FALLBACK_SPREADSHEET_ID);
  }
}

/**
 * รองรับการดึงข้อมูลแบบ GET (เช่น ?action=getMembers หรือเปิดหน้าเว็บ)
 */
function doGet(e) {
  var action = (e && e.parameter && e.parameter.action) || '';

  if (action === 'getMembers') {
    var data = getMembersFromSheet();
    return ContentService.createTextOutput(JSON.stringify(data))
      .setMimeType(ContentService.MimeType.JSON);
  }

  if (action === 'ping') {
    return ContentService.createTextOutput(JSON.stringify({ status: 'online', time: new Date().toISOString() }))
      .setMimeType(ContentService.MimeType.JSON);
  }

  // หากเปิดตรงๆ ผ่านบราวเซอร์ และมีไฟล์ index.html ให้แสดงหน้าเว็บ
  try {
    var template = HtmlService.createTemplateFromFile('index');
    return template.evaluate()
      .setTitle('ระบบสมาชิกและแผนที่แพทย์เวชศาสตร์ครอบครัว (Google Drive Realtime)')
      .addMetaTag('viewport', 'width=device-width, initial-scale=1.0')
      .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
  } catch (err) {
    var info = {
      status: 'online',
      name: 'Medical Member Dashboard API',
      spreadsheetId: SPREADSHEET_ID,
      time: new Date().toISOString()
    };
    return ContentService.createTextOutput(JSON.stringify(info))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

/**
 * API Endpoint รองรับการรับข้อมูลแบบ POST จาก Dashboard (บันทึกข้อมูล/ย้ายหมุด)
 */
function doPost(e) {
  try {
    var contents = (e && e.postData && e.postData.contents) ? e.postData.contents : '{}';
    var data = JSON.parse(contents);
    var action = data.action;

    if (action === 'updateCoordinate') {
      var res = updateDoctorCoordinateInSheet(data.memberId, data.lat, data.lng, data.workplace, data.sourceType);
      return ContentService.createTextOutput(JSON.stringify({ status: 'success', result: res }))
        .setMimeType(ContentService.MimeType.JSON);
    } else if (action === 'saveMember') {
      var res = saveMemberInSheet(data.member);
      return ContentService.createTextOutput(JSON.stringify({ status: 'success', result: res }))
        .setMimeType(ContentService.MimeType.JSON);
    } else if (action === 'getLatestData' || action === 'getMembers') {
      var res = getMembersFromSheet();
      return ContentService.createTextOutput(JSON.stringify({ status: 'success', data: res }))
        .setMimeType(ContentService.MimeType.JSON);
    }

    return ContentService.createTextOutput(JSON.stringify({ status: 'error', message: 'Unknown action: ' + action }))
      .setMimeType(ContentService.MimeType.JSON);
  } catch (err) {
    return ContentService.createTextOutput(JSON.stringify({ status: 'error', message: err.toString() }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

/**
 * ดึงข้อมูลสมาชิกทั้งหมดจาก Sheet แปลงเป็น JSON Object ส่งให้หน้าเว็บ
 */
function getMembersFromSheet() {
  var ss = getActiveSpreadsheet();
  var sheet = ss.getSheetByName('02_สมาชิกอัปเดตแล้ว_Sheet_314') ||
              ss.getSheetByName('01_ทะเบียนแพทย์_Master_3750') ||
              ss.getSheetByName('การตอบแบบฟอร์ม 1');
  if (!sheet) return { status: 'error', message: 'ไม่พบชีตข้อมูลสมาชิก', members: [] };

  var values = sheet.getDataRange().getValues();
  if (values.length < 2) return { status: 'success', count: 0, members: [] };

  var headers = values[0];
  var colMap = {};
  for (var c = 0; c < headers.length; c++) {
    colMap[String(headers[c]).trim()] = c;
  }

  var idxId = colMap['ID'] !== undefined ? colMap['ID'] : 0;
  var idxNameTh = colMap['ชื่อ_สกุล_ไทย'] !== undefined ? colMap['ชื่อ_สกุล_ไทย'] : (colMap['ชื่อ_สกุล'] !== undefined ? colMap['ชื่อ_สกุล'] : 1);
  var idxNameEn = colMap['ชื่อ_สกุล_อังกฤษ'] !== undefined ? colMap['ชื่อ_สกุล_อังกฤษ'] : 2;
  var idxTitleTh = colMap['คำนำหน้า'] !== undefined ? colMap['คำนำหน้า'] : 3;
  var idxFirstTh = colMap['ชื่อ'] !== undefined ? colMap['ชื่อ'] : (colMap['ชื่อ_ไทย'] !== undefined ? colMap['ชื่อ_ไทย'] : 4);
  var idxLastTh = colMap['นามสกุล'] !== undefined ? colMap['นามสกุล'] : (colMap['นามสกุล_ไทย'] !== undefined ? colMap['นามสกุล_ไทย'] : 5);
  var idxLicense = colMap['เลขที่ใบประกอบ_ว'] !== undefined ? colMap['เลขที่ใบประกอบ_ว'] : 6;
  var idxCertGroup = colMap['ประเภทคุณวุฒิ'] !== undefined ? colMap['ประเภทคุณวุฒิ'] : 7;
  var idxCertYear = colMap['ปีที่ได้รับ'] !== undefined ? colMap['ปีที่ได้รับ'] : 8;
  var idxMedSchool = colMap['แพทยศาสตรบัณฑิตจาก'] !== undefined ? colMap['แพทยศาสตรบัณฑิตจาก'] : 9;
  var idxTrainInst = colMap['สถาบันฝึกอบรม'] !== undefined ? colMap['สถาบันฝึกอบรม'] : 10;
  var idxWorkplace = colMap['สถานที่ทำงาน'] !== undefined ? colMap['สถานที่ทำงาน'] : 11;
  var idxWpType = colMap['สังกัด'] !== undefined ? colMap['สังกัด'] : (colMap['ประเภทสังกัด'] !== undefined ? colMap['ประเภทสังกัด'] : 12);
  var idxTambon = colMap['ตำบล'] !== undefined ? colMap['ตำบล'] : (colMap['ตำบล_แขวง'] !== undefined ? colMap['ตำบล_แขวง'] : 13);
  var idxAmphoe = colMap['อำเภอ'] !== undefined ? colMap['อำเภอ'] : (colMap['อำเภอ_เขต'] !== undefined ? colMap['อำเภอ_เขต'] : 14);
  var idxProvince = colMap['จังหวัด'] !== undefined ? colMap['จังหวัด'] : 15;
  var idxZipcode = colMap['รหัสไปรษณีย์'] !== undefined ? colMap['รหัสไปรษณีย์'] : 16;
  var idxZone = colMap['เขตสุขภาพ'] !== undefined ? colMap['เขตสุขภาพ'] : 17;
  var idxLat = colMap['ละติจูด'] !== undefined ? colMap['ละติจูด'] : (colMap['ละติจูด_Lat'] !== undefined ? colMap['ละติจูด_Lat'] : 18);
  var idxLng = colMap['ลองจิจูด'] !== undefined ? colMap['ลองจิจูด'] : (colMap['ลองจิจูด_Lng'] !== undefined ? colMap['ลองจิจูด_Lng'] : 19);
  var idxPhone = colMap['โทรศัพท์มือถือ'] !== undefined ? colMap['โทรศัพท์มือถือ'] : 20;
  var idxEmail = colMap['อีเมล'] !== undefined ? colMap['อีเมล'] : 21;
  var idxPhotoDrive = colMap['Drive_Photo_ID'] !== undefined ? colMap['Drive_Photo_ID'] : (colMap['Google_Drive_Photo_ID'] !== undefined ? colMap['Google_Drive_Photo_ID'] : 22);
  var idxPhotoUrl = colMap['Drive_Image_URL'] !== undefined ? colMap['Drive_Image_URL'] : 23;

  var members = [];
  for (var r = 1; r < values.length; r++) {
    var row = values[r];
    var nameTh = String(row[idxNameTh] || '').trim();
    var firstTh = String(row[idxFirstTh] || '').trim();
    var lastTh = String(row[idxLastTh] || '').trim();
    if (!nameTh && !firstTh) continue;

    var fullTh = nameTh || (firstTh + ' ' + lastTh);
    var driveId = String(row[idxPhotoDrive] || '').trim();
    var pUrl = String(row[idxPhotoUrl] || '').trim();
    if (!pUrl && driveId) {
      pUrl = 'https://lh3.googleusercontent.com/d/' + driveId + '=w500';
    }

    members.push({
      id: parseInt(row[idxId], 10) || r,
      fullNameTh: fullTh,
      fullNameEn: String(row[idxNameEn] || '').trim(),
      titleTh: String(row[idxTitleTh] || '').trim(),
      firstNameTh: firstTh,
      lastNameTh: lastTh,
      licenseNo: String(row[idxLicense] || '').trim(),
      certGroup: String(row[idxCertGroup] || '').trim(),
      certYear: String(row[idxCertYear] || '').trim(),
      medSchool: String(row[idxMedSchool] || '').trim(),
      trainingInstitute: String(row[idxTrainInst] || '').trim(),
      workplace: {
        name: String(row[idxWorkplace] || '').trim(),
        type: String(row[idxWpType] || 'รัฐบาล').trim(),
        tambon: String(row[idxTambon] || '').trim(),
        amphoe: String(row[idxAmphoe] || '').trim(),
        province: String(row[idxProvince] || '').trim(),
        zipcode: String(row[idxZipcode] || '').trim()
      },
      healthZone: String(row[idxZone] || '').trim(),
      lat: parseFloat(row[idxLat]) || 0,
      lng: parseFloat(row[idxLng]) || 0,
      mobilePhone: String(row[idxPhone] || '').trim(),
      email: String(row[idxEmail] || '').trim(),
      photoDriveId: driveId,
      photoUrl: pUrl
    });
  }

  return {
    status: 'success',
    sheetName: sheet.getName(),
    count: members.length,
    lastUpdate: new Date().toISOString(),
    members: members
  };
}

/**
 * อัปเดตพิกัดละติจูดและลองจิจูดลง Google Sheet โดยตรง
 */
function updateDoctorCoordinateInSheet(memberId, lat, lng, workplace, sourceType) {
  var ss = getActiveSpreadsheet();
  var sheet = ss.getSheetByName('02_สมาชิกอัปเดตแล้ว_Sheet_314') ||
              ss.getSheetByName('01_ทะเบียนแพทย์_Master_3750') ||
              ss.getSheetByName('การตอบแบบฟอร์ม 1');
  if (!sheet) return { success: false, message: 'ไม่พบชีต' };

  var id = parseInt(memberId, 10);
  var lastRow = sheet.getLastRow();
  var lastCol = sheet.getLastColumn();
  if (lastRow < 2) return { success: false, message: 'ไม่มีข้อมูลในชีต' };

  var headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
  var idCol = -1, latCol = -1, lngCol = -1, wpCol = -1;

  for (var c = 0; c < headers.length; c++) {
    var h = String(headers[c]).trim();
    if (h === 'ID') idCol = c + 1;
    if (h === 'ละติจูด' || h === 'ละติจูด_Lat' || h.toLowerCase() === 'latitude') latCol = c + 1;
    if (h === 'ลองจิจูด' || h === 'ลองจิจูด_Lng' || h.toLowerCase() === 'longitude') lngCol = c + 1;
    if (h === 'สถานที่ทำงาน') wpCol = c + 1;
  }

  var targetRow = -1;
  if (idCol > 0) {
    var idValues = sheet.getRange(1, idCol, lastRow, 1).getValues();
    for (var r = 1; r < idValues.length; r++) {
      if (parseInt(idValues[r][0], 10) === id) {
        targetRow = r + 1;
        break;
      }
    }
  }

  if (targetRow > 1 && targetRow <= lastRow) {
    if (latCol > 0 && lngCol > 0) {
      sheet.getRange(targetRow, latCol).setValue(lat);
      sheet.getRange(targetRow, lngCol).setValue(lng);
    }
    if (wpCol > 0 && workplace) {
      sheet.getRange(targetRow, wpCol).setValue(workplace);
    }
    return { success: true, memberId: id, row: targetRow, lat: lat, lng: lng, updatedTime: new Date().toISOString() };
  }

  return { success: false, message: 'ไม่พบรหัสสมาชิก ID ' + id };
}

/**
 * บันทึกหรือแก้ไขข้อมูลสมาชิกใน Sheet
 */
function saveMemberInSheet(member) {
  if (!member) return { success: false, message: 'ไม่มีข้อมูลสมาชิก' };

  var ss = getActiveSpreadsheet();
  var sheet = ss.getSheetByName('02_สมาชิกอัปเดตแล้ว_Sheet_314') ||
              ss.getSheetByName('01_ทะเบียนแพทย์_Master_3750') ||
              ss.getSheetByName('การตอบแบบฟอร์ม 1');
  if (!sheet) return { success: false, message: 'ไม่พบชีต' };

  var lastRow = sheet.getLastRow();
  var lastCol = sheet.getLastColumn();
  var headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0];

  var colMap = {};
  for (var c = 0; c < headers.length; c++) {
    colMap[String(headers[c]).trim()] = c + 1;
  }

  var idCol = colMap['ID'] || 1;
  var targetRow = -1;

  if (member.id) {
    var idValues = sheet.getRange(1, idCol, lastRow, 1).getValues();
    var searchId = parseInt(member.id, 10);
    for (var r = 1; r < idValues.length; r++) {
      if (parseInt(idValues[r][0], 10) === searchId) {
        targetRow = r + 1;
        break;
      }
    }
  }

  var wpName = (member.workplace && member.workplace.name) || '';
  var wpType = (member.workplace && member.workplace.type) || 'รัฐบาล';
  var wpTambon = (member.workplace && member.workplace.tambon) || '';
  var wpAmphoe = (member.workplace && member.workplace.amphoe) || '';
  var wpProvince = (member.workplace && member.workplace.province) || '';
  var wpZipcode = (member.workplace && member.workplace.zipcode) || '';
  var fullName = member.fullNameTh || ((member.firstNameTh || '') + ' ' + (member.lastNameTh || ''));

  if (targetRow > 1) {
    // แก้ไขแถวเดิม
    if (colMap['ชื่อ_สกุล_ไทย']) sheet.getRange(targetRow, colMap['ชื่อ_สกุล_ไทย']).setValue(fullName);
    if (colMap['คำนำหน้า']) sheet.getRange(targetRow, colMap['คำนำหน้า']).setValue(member.titleTh || '');
    if (colMap['ชื่อ']) sheet.getRange(targetRow, colMap['ชื่อ']).setValue(member.firstNameTh || '');
    if (colMap['นามสกุล']) sheet.getRange(targetRow, colMap['นามสกุล']).setValue(member.lastNameTh || '');
    if (colMap['เลขที่ใบประกอบ_ว']) sheet.getRange(targetRow, colMap['เลขที่ใบประกอบ_ว']).setValue(member.licenseNo || '');
    if (colMap['ประเภทคุณวุฒิ']) sheet.getRange(targetRow, colMap['ประเภทคุณวุฒิ']).setValue(member.certGroup || '');
    if (colMap['ปีที่ได้รับ']) sheet.getRange(targetRow, colMap['ปีที่ได้รับ']).setValue(member.certYear || '');
    if (colMap['แพทยศาสตรบัณฑิตจาก']) sheet.getRange(targetRow, colMap['แพทยศาสตรบัณฑิตจาก']).setValue(member.medSchool || '');
    if (colMap['สถาบันฝึกอบรม']) sheet.getRange(targetRow, colMap['สถาบันฝึกอบรม']).setValue(member.trainingInstitute || '');
    if (colMap['สถานที่ทำงาน']) sheet.getRange(targetRow, colMap['สถานที่ทำงาน']).setValue(wpName);
    if (colMap['สังกัด']) sheet.getRange(targetRow, colMap['สังกัด']).setValue(wpType);
    if (colMap['ตำบล']) sheet.getRange(targetRow, colMap['ตำบล']).setValue(wpTambon);
    if (colMap['อำเภอ']) sheet.getRange(targetRow, colMap['อำเภอ']).setValue(wpAmphoe);
    if (colMap['จังหวัด']) sheet.getRange(targetRow, colMap['จังหวัด']).setValue(wpProvince);
    if (colMap['รหัสไปรษณีย์']) sheet.getRange(targetRow, colMap['รหัสไปรษณีย์']).setValue(wpZipcode);
    if (colMap['เขตสุขภาพ']) sheet.getRange(targetRow, colMap['เขตสุขภาพ']).setValue(member.healthZone || '');
    if (colMap['ละติจูด'] && member.lat) sheet.getRange(targetRow, colMap['ละติจูด']).setValue(member.lat);
    if (colMap['ลองจิจูด'] && member.lng) sheet.getRange(targetRow, colMap['ลองจิจูด']).setValue(member.lng);
    if (colMap['โทรศัพท์มือถือ']) sheet.getRange(targetRow, colMap['โทรศัพท์มือถือ']).setValue(member.mobilePhone || '');
    if (colMap['อีเมล']) sheet.getRange(targetRow, colMap['อีเมล']).setValue(member.email || '');
    if (colMap['Drive_Photo_ID'] && member.photoDriveId) sheet.getRange(targetRow, colMap['Drive_Photo_ID']).setValue(member.photoDriveId);
    return { success: true, status: 'updated', id: member.id, row: targetRow, updatedTime: new Date().toISOString() };
  } else {
    // เพิ่มแถวใหม่ต่อท้าย
    var newId = lastRow;
    sheet.appendRow([
      newId,
      fullName,
      member.fullNameEn || '',
      member.titleTh || '',
      member.firstNameTh || '',
      member.lastNameTh || '',
      member.licenseNo || '',
      member.certGroup || 'วว. แผน ก (Formal training)',
      member.certYear || '',
      member.medSchool || '',
      member.trainingInstitute || '',
      wpName,
      wpType,
      wpTambon,
      wpAmphoe,
      wpProvince,
      wpZipcode,
      member.healthZone || '',
      member.lat || '',
      member.lng || '',
      member.mobilePhone || '',
      member.email || '',
      member.photoDriveId || '',
      member.photoUrl || ''
    ]);
    return { success: true, status: 'created', id: newId, row: sheet.getLastRow() };
  }
}
