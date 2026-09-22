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
 * รองรับการดึงข้อมูลและบันทึกข้อมูลแบบ GET (เช่น ?action=getMembers หรือ ?action=updateCoordinate)
 */
function doGet(e) {
  var action = (e && e.parameter && e.parameter.action) || '';

  if (action === 'getMembers') {
    var data = getMembersFromSheet();
    return ContentService.createTextOutput(JSON.stringify(data))
      .setMimeType(ContentService.MimeType.JSON);
  }

  if (action === 'ping') {
    return ContentService.createTextOutput(JSON.stringify({ status: 'online', spreadsheetId: SPREADSHEET_ID, time: new Date().toISOString() }))
      .setMimeType(ContentService.MimeType.JSON);
  }

  if (action === 'updateCoordinate' && e && e.parameter) {
    try {
      var p = e.parameter;
      var res = updateDoctorCoordinateInSheet(p.memberId, parseFloat(p.lat), parseFloat(p.lng), p.workplace || '', p.sourceType || 'sheet');
      return ContentService.createTextOutput(JSON.stringify({ status: 'success', result: res }))
        .setMimeType(ContentService.MimeType.JSON);
    } catch (err) {
      return ContentService.createTextOutput(JSON.stringify({ status: 'error', message: err.toString() }))
        .setMimeType(ContentService.MimeType.JSON);
    }
  }

  if (action === 'saveMember' && e && e.parameter && e.parameter.data) {
    try {
      var raw = e.parameter.data;
      var memberObj;
      try {
        memberObj = JSON.parse(raw);
      } catch (e1) {
        memberObj = JSON.parse(decodeURIComponent(raw));
      }
      var res = saveMemberInSheet(memberObj);
      return ContentService.createTextOutput(JSON.stringify({ status: 'success', result: res }))
        .setMimeType(ContentService.MimeType.JSON);
    } catch (err) {
      return ContentService.createTextOutput(JSON.stringify({ status: 'error', message: err.toString() }))
        .setMimeType(ContentService.MimeType.JSON);
    }
  }

  var info = {
    status: 'online',
    name: 'Medical Member Dashboard API (ThaiFamMed)',
    spreadsheetId: SPREADSHEET_ID,
    time: new Date().toISOString()
  };
  return ContentService.createTextOutput(JSON.stringify(info))
    .setMimeType(ContentService.MimeType.JSON);
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
              ss.getSheetByName('การตอบแบบฟอร์ม 1') ||
              (ss.getSheets().length > 0 ? ss.getSheets()[0] : null);
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
              ss.getSheetByName('การตอบแบบฟอร์ม 1') ||
              (ss.getSheets().length > 0 ? ss.getSheets()[0] : null);
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

const DRIVE_FOLDER_ID = '1kG-hz2vQ1hwbw-vX2xs80PyZhAN9ARz6';

/**
 * จัดการบันทึกรูปภาพลง Google Drive โฟลเดอร์ "ระบบสมาชิก"
 */
function processPhotoAndSaveToDrive(member) {
  if (!member) return;
  var rawPhoto = member.photoUrl || '';
  if (rawPhoto.indexOf('data:image') === 0) {
    try {
      var folder;
      try {
        folder = DriveApp.getFolderById(DRIVE_FOLDER_ID);
      } catch (fErr) {
        folder = DriveApp.getRootFolder();
      }
      var parts = rawPhoto.split(',');
      var meta = parts[0];
      var base64 = parts[1];
      var mime = 'image/jpeg';
      if (meta.indexOf('image/png') !== -1) mime = 'image/png';
      else if (meta.indexOf('image/webp') !== -1) mime = 'image/webp';

      var ext = mime === 'image/png' ? 'png' : 'jpg';
      var fileName = 'doctor_' + (member.licenseNo || member.id || Date.now()) + '.' + ext;
      var blob = Utilities.newBlob(Utilities.base64Decode(base64), mime, fileName);
      var file = folder.createFile(blob);
      try {
        file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
      } catch (shareErr) {}
      var fileId = file.getId();
      member.photoDriveId = fileId;
      member.photoUrl = 'https://lh3.googleusercontent.com/d/' + fileId + '=w500';
      Logger.log('Saved photo to Drive successfully. ID: ' + fileId);
    } catch (photoErr) {
      Logger.log('Failed to save photo to Drive: ' + photoErr);
    }
  } else if (rawPhoto && !member.photoDriveId) {
    var driveMatch = rawPhoto.match(/[-\w]{25,}/);
    if (driveMatch && (rawPhoto.indexOf('drive.google.com') !== -1 || rawPhoto.indexOf('googleusercontent.com') !== -1)) {
      member.photoDriveId = driveMatch[0];
      member.photoUrl = 'https://lh3.googleusercontent.com/d/' + driveMatch[0] + '=w500';
    }
  }
}

/**
 * บันทึกหรือแก้ไขข้อมูลสมาชิกใน Sheet
 */
function saveMemberInSheet(member) {
  if (!member) return { success: false, message: 'ไม่มีข้อมูลสมาชิก' };

  // ประมวลผลรูปภาพและอัปโหลดขึ้น Google Drive
  processPhotoAndSaveToDrive(member);

  var ss = getActiveSpreadsheet();
  var sheet = ss.getSheetByName('02_สมาชิกอัปเดตแล้ว_Sheet_314') ||
              ss.getSheetByName('01_ทะเบียนแพทย์_Master_3750') ||
              ss.getSheetByName('การตอบแบบฟอร์ม 1') ||
              (ss.getSheets().length > 0 ? ss.getSheets()[0] : null);
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

  // 1. ค้นหาแถวตาม ID (ถ้าเป็นรหัสสมาชิกปกติ)
  if (member.id && parseInt(member.id, 10) < 1000000) {
    var idValues = sheet.getRange(1, idCol, lastRow, 1).getValues();
    var searchId = parseInt(member.id, 10);
    for (var r = 1; r < idValues.length; r++) {
      if (parseInt(idValues[r][0], 10) === searchId) {
        targetRow = r + 1;
        break;
      }
    }
  }

  // 2. ถ้าไม่พบตาม ID ให้ค้นหาตามเลขที่ใบประกอบวิชาชีพเวชกรรม (ว.)
  if (targetRow === -1 && member.licenseNo && colMap['เลขที่ใบประกอบ_ว']) {
    var licCol = colMap['เลขที่ใบประกอบ_ว'];
    var licValues = sheet.getRange(1, licCol, lastRow, 1).getValues();
    var searchLic = String(member.licenseNo).replace(/[^0-9]/g, '').trim();
    if (searchLic) {
      for (var r = 1; r < licValues.length; r++) {
        var rowLic = String(licValues[r][0]).replace(/[^0-9]/g, '').trim();
        if (rowLic && rowLic === searchLic) {
          targetRow = r + 1;
          break;
        }
      }
    }
  }

  // 3. ถ้ายังไม่พบ ให้ค้นหาตามชื่อ-สกุลแพทย์
  if (targetRow === -1 && (member.firstNameTh || member.fullNameTh)) {
    var nameCol = colMap['ชื่อ_สกุล_ไทย'] || colMap['ชื่อ_สกุล'] || 2;
    var nameValues = sheet.getRange(1, nameCol, lastRow, 1).getValues();
    var cleanSearchName = String(member.firstNameTh || member.fullNameTh)
      .replace(/^(นพ\.|พญ\.|นายแพทย์|แพทย์หญิง|นาย|นางสาว|นาง)\s*/, '')
      .trim();
    if (cleanSearchName.length >= 3) {
      for (var r = 1; r < nameValues.length; r++) {
        var rowName = String(nameValues[r][0] || '');
        if (rowName && rowName.indexOf(cleanSearchName) !== -1) {
          targetRow = r + 1;
          break;
        }
      }
    }
  }

  var wpName = (member.workplace && member.workplace.name) || (typeof member.workplace === 'string' ? member.workplace : '') || '';
  var wpType = (member.workplace && member.workplace.type) || 'รัฐบาล';
  var wpTambon = (member.workplace && member.workplace.tambon) || '';
  var wpAmphoe = (member.workplace && member.workplace.amphoe) || '';
  var wpProvince = (member.workplace && member.workplace.province) || '';
  var wpZipcode = (member.workplace && member.workplace.zipcode) || '';
  var fullName = member.fullNameTh || ((member.firstNameTh || '') + ' ' + (member.lastNameTh || ''));

  if (targetRow > 1) {
    // แก้ไขแถวเดิมที่มีอยู่แล้ว
    if (colMap['ชื่อ_สกุล_ไทย']) sheet.getRange(targetRow, colMap['ชื่อ_สกุล_ไทย']).setValue(fullName);
    if (colMap['คำนำหน้า'] && member.titleTh) sheet.getRange(targetRow, colMap['คำนำหน้า']).setValue(member.titleTh);
    if (colMap['ชื่อ'] && member.firstNameTh) sheet.getRange(targetRow, colMap['ชื่อ']).setValue(member.firstNameTh);
    if (colMap['นามสกุล'] && member.lastNameTh) sheet.getRange(targetRow, colMap['นามสกุล']).setValue(member.lastNameTh);
    if (colMap['เลขที่ใบประกอบ_ว'] && member.licenseNo) sheet.getRange(targetRow, colMap['เลขที่ใบประกอบ_ว']).setValue(member.licenseNo);
    if (colMap['ประเภทคุณวุฒิ'] && member.certGroup) sheet.getRange(targetRow, colMap['ประเภทคุณวุฒิ']).setValue(member.certGroup);
    if (colMap['ปีที่ได้รับ'] && member.certYear) sheet.getRange(targetRow, colMap['ปีที่ได้รับ']).setValue(member.certYear);
    if (colMap['แพทยศาสตรบัณฑิตจาก'] && member.medSchool) sheet.getRange(targetRow, colMap['แพทยศาสตรบัณฑิตจาก']).setValue(member.medSchool);
    if (colMap['สถาบันฝึกอบรม'] && member.trainingInstitute) sheet.getRange(targetRow, colMap['สถาบันฝึกอบรม']).setValue(member.trainingInstitute);
    if (colMap['สถานที่ทำงาน'] && wpName) sheet.getRange(targetRow, colMap['สถานที่ทำงาน']).setValue(wpName);
    if (colMap['สังกัด'] && wpType) sheet.getRange(targetRow, colMap['สังกัด']).setValue(wpType);
    if (colMap['ตำบล'] && wpTambon) sheet.getRange(targetRow, colMap['ตำบล']).setValue(wpTambon);
    if (colMap['อำเภอ'] && wpAmphoe) sheet.getRange(targetRow, colMap['อำเภอ']).setValue(wpAmphoe);
    if (colMap['จังหวัด'] && wpProvince) sheet.getRange(targetRow, colMap['จังหวัด']).setValue(wpProvince);
    if (colMap['รหัสไปรษณีย์'] && wpZipcode) sheet.getRange(targetRow, colMap['รหัสไปรษณีย์']).setValue(wpZipcode);
    if (colMap['เขตสุขภาพ'] && member.healthZone) sheet.getRange(targetRow, colMap['เขตสุขภาพ']).setValue(member.healthZone);
    if (colMap['ละติจูด'] && member.lat) sheet.getRange(targetRow, colMap['ละติจูด']).setValue(member.lat);
    if (colMap['ลองจิจูด'] && member.lng) sheet.getRange(targetRow, colMap['ลองจิจูด']).setValue(member.lng);
    if (colMap['โทรศัพท์มือถือ'] && member.mobilePhone) sheet.getRange(targetRow, colMap['โทรศัพท์มือถือ']).setValue(member.mobilePhone);
    if (colMap['อีเมล'] && member.email) sheet.getRange(targetRow, colMap['อีเมล']).setValue(member.email);
    if (colMap['Drive_Photo_ID'] && member.photoDriveId) sheet.getRange(targetRow, colMap['Drive_Photo_ID']).setValue(member.photoDriveId);
    if (colMap['Drive_Image_URL'] && member.photoUrl) sheet.getRange(targetRow, colMap['Drive_Image_URL']).setValue(member.photoUrl);
    var actualId = sheet.getRange(targetRow, idCol).getValue() || member.id;
    return {
      success: true,
      status: 'updated',
      id: actualId,
      row: targetRow,
      photoDriveId: member.photoDriveId || '',
      photoUrl: member.photoUrl || '',
      updatedTime: new Date().toISOString()
    };
  } else {
    // เพิ่มแถวใหม่ต่อท้าย พร้อมรัน ID ตามลำดับจริง
    var maxId = 0;
    if (lastRow > 1) {
      var allIds = sheet.getRange(2, idCol, lastRow - 1, 1).getValues();
      for (var i = 0; i < allIds.length; i++) {
        var val = parseInt(allIds[i][0], 10);
        if (!isNaN(val) && val > maxId && val < 1000000) maxId = val;
      }
    }
    var newId = maxId > 0 ? (maxId + 1) : lastRow;
    sheet.appendRow([
      newId,
      fullName,
      member.fullNameEn || '',
      member.titleTh || '',
      member.firstNameTh || '',
      member.lastNameTh || '',
      member.licenseNo || '',
      member.certGroup || 'วุฒิบัตร/อนุมัติ เวชศาสตร์ครอบครัว',
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
    return {
      success: true,
      status: 'created',
      id: newId,
      row: sheet.getLastRow(),
      photoDriveId: member.photoDriveId || '',
      photoUrl: member.photoUrl || '',
      updatedTime: new Date().toISOString()
    };
  }
}

/**
 * =========================================================================
 * BACKUP SYSTEM
 * =========================================================================
 */
const BACKUP_FOLDER_ID = '1toJRwIIqLfqwrM5_UGKoSb56GtXVidub'; // โฟลเดอร์ Backup

/**
 * ฟังก์ชันสำหรับคัดลอกไฟล์ Sheet เพื่อสำรองข้อมูล
 * จะถูกเรียกใช้อัตโนมัติทุกวันผ่าน Trigger
 */
function autoBackupDatabase() {
  var sourceDbId = SPREADSHEET_ID; 
  var sourceFile = DriveApp.getFileById(sourceDbId);
  var backupFolder = DriveApp.getFolderById(BACKUP_FOLDER_ID);
  
  // 1. สร้างไฟล์ Backup ใหม่ พร้อมวันที่-เวลา
  var dateString = Utilities.formatDate(new Date(), "Asia/Bangkok", "yyyy-MM-dd_HH-mm");
  var backupFileName = "Backup_MemberDB_" + dateString;
  
  var copiedFile = sourceFile.makeCopy(backupFileName, backupFolder);
  Logger.log('Created backup: ' + copiedFile.getUrl());
  
  // 2. ตรวจสอบและลบไฟล์ Backup ที่เก่ากว่า 30 วัน (Rolling Backup)
  var cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - 30); // ย้อนหลัง 30 วัน
  
  var files = backupFolder.getFiles();
  var deletedCount = 0;
  while (files.hasNext()) {
    var file = files.next();
    // เช็คว่าเป็นไฟล์ Backup ของเราและสร้างไว้นานกว่า 30 วัน
    if (file.getName().indexOf("Backup_MemberDB_") === 0) {
      if (file.getDateCreated() < cutoffDate) {
        file.setTrashed(true); // ย้ายไปถังขยะ
        deletedCount++;
      }
    }
  }
  Logger.log('Deleted old backups: ' + deletedCount + ' files.');
}

/**
 * ฟังก์ชันสำหรับติดตั้ง Trigger อัตโนมัติ (รันแค่ครั้งเดียวเพื่อตั้งเวลา)
 */
function setupBackupTrigger() {
  // ลบ Trigger เดิมที่มีอยู่ก่อน (เพื่อป้องกันการทำงานซ้ำซ้อน)
  var triggers = ScriptApp.getProjectTriggers();
  for (var i = 0; i < triggers.length; i++) {
    if (triggers[i].getHandlerFunction() === 'autoBackupDatabase') {
      ScriptApp.deleteTrigger(triggers[i]);
    }
  }
  
  // สร้าง Trigger ใหม่ ให้รันทุกวัน เวลาประมาณตี 2
  ScriptApp.newTrigger('autoBackupDatabase')
    .timeBased()
    .everyDays(1)
    .atHour(2)
    .create();
    
  Logger.log('ตั้งค่า Trigger สำเร็จ: สำรองข้อมูลอัตโนมัติทุกวันเวลาตี 2');
}
