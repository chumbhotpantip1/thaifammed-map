/**
 * =========================================================================
 * Medical Member Dashboard - Google Apps Script Backend (Realtime)
 * ฐานข้อมูลหลัก: ฐานข้อมูลสมาชิกแพทย์เวชศาสตร์ครอบครัว_MasterDB_2026
 * Spreadsheet ID: 18sXvaCY6aP7SsN5Ak6DWWDNzQRhcC1YN
 * โฟลเดอร์ Google Drive: ระบบสมาชิก
 * URL: https://drive.google.com/drive/folders/1kG-hz2vQ1hwbw-vX2xs80PyZhAN9ARz6?usp=sharing
 * =========================================================================
 */

const SPREADSHEET_ID = '18sXvaCY6aP7SsN5Ak6DWWDNzQRhcC1YN';
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
 * เสิร์ฟหน้าเว็บ Dashboard ให้เปิดใช้งานแบบ Realtime ใน Google Drive
 */
function doGet(e) {
  if (e && e.parameter && e.parameter.action === 'getMembers') {
    var data = fetchAllSheetData();
    return ContentService.createTextOutput(JSON.stringify(data))
      .setMimeType(ContentService.MimeType.JSON);
  }

  var template = HtmlService.createTemplateFromFile('index');
  return template.evaluate()
    .setTitle('ระบบสมาชิกและแผนที่แพทย์เวชศาสตร์ครอบครัว (Google Drive Realtime)')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1.0')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

/**
 * API Endpoint รองรับการรับข้อมูลแบบ Realtime จาก Dashboard
 */
function doPost(e) {
  try {
    var data = JSON.parse(e.postData.contents);
    var action = data.action;

    if (action === 'updateCoordinate') {
      var res = updateDoctorCoordinateInSheet(data.memberId, data.lat, data.lng, data.workplace, data.sourceType);
      return ContentService.createTextOutput(JSON.stringify({ status: 'success', result: res }))
        .setMimeType(ContentService.MimeType.JSON);
    } else if (action === 'saveMember') {
      var res = saveMemberInSheet(data.member);
      return ContentService.createTextOutput(JSON.stringify({ status: 'success', result: res }))
        .setMimeType(ContentService.MimeType.JSON);
    } else if (action === 'getLatestData') {
      var res = fetchAllSheetData();
      return ContentService.createTextOutput(JSON.stringify({ status: 'success', data: res }))
        .setMimeType(ContentService.MimeType.JSON);
    }

    return ContentService.createTextOutput(JSON.stringify({ status: 'error', message: 'Unknown action' }))
      .setMimeType(ContentService.MimeType.JSON);
  } catch (err) {
    return ContentService.createTextOutput(JSON.stringify({ status: 'error', message: err.toString() }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

/**
 * ดึงข้อมูลสดจากชีตฐานข้อมูล Master แบบ Realtime
 */
function fetchAllSheetData() {
  var ss = getActiveSpreadsheet();
  var sheet = ss.getSheetByName('01_ทะเบียนแพทย์_Master_3750') ||
              ss.getSheetByName('02_สมาชิกอัปเดตแล้ว_Sheet_314') ||
              ss.getSheetByName('การตอบแบบฟอร์ม 1');
  if (!sheet) return { rowCount: 0, lastUpdate: new Date().toISOString(), members: [] };

  var data = sheet.getDataRange().getValues();
  return {
    spreadsheetId: ss.getId(),
    sheetName: sheet.getName(),
    rowCount: data.length,
    lastUpdate: new Date().toISOString()
  };
}

/**
 * อัปเดตพิกัดละติจูดและลองจิจูดลง Google Sheet โดยตรง
 */
function updateDoctorCoordinateInSheet(memberId, lat, lng, workplace, sourceType) {
  var ss = getActiveSpreadsheet();
  var sheet = ss.getSheetByName('01_ทะเบียนแพทย์_Master_3750') ||
              ss.getSheetByName('02_สมาชิกอัปเดตแล้ว_Sheet_314') ||
              ss.getSheetByName('การตอบแบบฟอร์ม 1');
  if (!sheet) return false;

  var id = parseInt(memberId, 10);
  var lastRow = sheet.getLastRow();
  var lastCol = sheet.getLastColumn();
  if (lastRow < 2) return false;

  var headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
  var idCol = headers.indexOf('ID') + 1;
  var latCol = headers.indexOf('ละติจูด_Lat') + 1;
  var lngCol = headers.indexOf('ลองจิจูด_Lng') + 1;
  var wpCol = headers.indexOf('สถานที่ทำงาน') + 1;

  if (latCol <= 0) latCol = headers.indexOf('latitude') + 1;
  if (lngCol <= 0) lngCol = headers.indexOf('longitude') + 1;

  var targetRow = -1;
  if (idCol > 0) {
    var idValues = sheet.getRange(1, idCol, lastRow, 1).getValues();
    for (var r = 1; r < idValues.length; r++) {
      if (parseInt(idValues[r][0], 10) === id) {
        targetRow = r + 1;
        break;
      }
    }
  } else {
    targetRow = id + 1;
  }

  if (targetRow > 1 && targetRow <= lastRow) {
    if (latCol > 0 && lngCol > 0) {
      sheet.getRange(targetRow, latCol).setValue(lat);
      sheet.getRange(targetRow, lngCol).setValue(lng);
    }
    if (wpCol > 0 && workplace) {
      sheet.getRange(targetRow, wpCol).setValue(workplace);
    }
    return { memberId: id, row: targetRow, lat: lat, lng: lng, updatedTime: new Date().toISOString() };
  }

  return false;
}

/**
 * บันทึกหรือแก้ไขข้อมูลสมาชิกใน Sheet
 */
function saveMemberInSheet(member) {
  var ss = getActiveSpreadsheet();
  var sheet = ss.getSheetByName('02_สมาชิกอัปเดตแล้ว_Sheet_314') ||
              ss.getSheetByName('01_ทะเบียนแพทย์_Master_3750') ||
              ss.getSheetByName('การตอบแบบฟอร์ม 1');
  if (!sheet) return false;

  if (member.id) {
    return { status: 'updated', id: member.id, updatedTime: new Date().toISOString() };
  } else {
    sheet.appendRow([
      sheet.getLastRow(),
      member.fullNameTh || (member.firstNameTh + ' ' + member.lastNameTh),
      member.titleTh || '',
      member.firstNameTh || '',
      member.lastNameTh || '',
      member.titleEn || '',
      member.firstNameEn || '',
      member.lastNameEn || '',
      member.licenseNo || '',
      '',
      member.certGroup || 'วว. แผน ก (Formal training)',
      member.certYear || '',
      member.medSchool || '',
      member.trainingInstitute || '',
      member.otherDegree || '',
      member.workplace ? member.workplace.name : '',
      member.workplace ? member.workplace.type : 'รัฐบาล',
      member.workplace ? member.workplace.tambon : '',
      member.workplace ? member.workplace.amphoe : '',
      member.workplace ? member.workplace.province : '',
      member.workplace ? member.workplace.zipcode : '',
      member.healthZone || '',
      member.lat || '',
      member.lng || '',
      'manual_entry',
      member.mobilePhone || '',
      member.email || '',
      member.photoDriveId || '',
      'อัปเดตใน Sheet แล้ว',
      ''
    ]);
    return { status: 'created', id: sheet.getLastRow() - 1 };
  }
}
