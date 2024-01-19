const { getDefaultAutoSelectFamilyAttemptTimeout } = require('net');

var cmd = require('node-cmd'),
    config = require('./config.json'),
    fs = require('fs'),
    gulp = require('gulp-help')(require('gulp')),
    gulpSequence = require('gulp-sequence'),
    PluginError = require('plugin-error'),
    readlineSync = require('readline-sync');


/**
 * await Job Callback - Callback is made without error if Job completes with 
 * CC < MaxRC in the allotted time
 * @callback awaitJobCallback
 * @param {Error} err 
 */


/**
  * commandObject - object contains command to submit and directory to download output to
  * @object commandObject
  * @param {string} command Command to submit
  * @param {string} dir     Directory to download command output to 
  */

/**
* Runs command and calls back without error if successful
* @param {string}           command           command to run
* @param {string}           dir               directory to log output to
* @param {awaitJobCallback} callback          function to call after completion
* @param {Array}            [expectedOutputs] array of expected strings to be in the output
*/
function simpleCommand(command, dir, callback, expectedOutputs){
  cmd.get(command, function(err, data, stderr) { 
    //log output
    var content = "Error:\n" + err + "\n" + "StdErr:\n" + stderr + "\n" + "Data:\n" + data;
    writeToFile(dir, content);
    
    if(err){
      callback(err);
    } else if (stderr){
      callback(new Error("\nCommand:\n" + command + "\n" + stderr + "Stack Trace:"));
    } else if(typeof expectedOutputs !== 'undefined'){
      verifyOutput(data, expectedOutputs, callback);
    } else {
      callback();
    }
  });
}

function downloadDb(jobid, dbtype, callback)
{
  var command = `zowe jobs view sfbi ${jobid} 104`;
  cmd.get(command, function(err, data, stderr) {
    if(err){
      callback(err);
    } else if (stderr){
      callback(new Error("\nCommand:\n" + command + "\n" + stderr + "Stack Trace:"));
    } else {
      writeDBToFile(dbtype, "dboutput", data);
    }
  });
} 
/**
* Submits job, verifies successful completion, stores output
* @param {string}           ds                  data-set to submit
* @param {string}           [dir="job-archive"] local directory to download spool to
* @param {number}           [maxRC=0]           maximum allowable return code
* @param {awaitJobCallback} callback            function to call after completion
*/
function submitJobAndDownloadOutput(ds, dir="job-archive", maxRC=0, dbtype, callback){
  var command = `zowe jobs submit data-set "${ds}" -d ${dir} --rfj`;
  cmd.get(command, function(err, data, stderr) { 
    //log output
    var content = "Error:\n" + err + "\n" + "StdErr:\n" + stderr + "\n" + "Data:\n" + data;
    writeToFile("command-archive/job-submission", content);

    if(err){
      callback(err);
    } else if (stderr){
      callback(new Error("\nCommand:\n" + command + "\n" + stderr + "Stack Trace:"));
    } else {
      data = JSON.parse(data).data;
      retcode = data.retcode;

      //retcode should be in the form CC nnnn where nnnn is the return code
      if (retcode.split(" ")[1] <= maxRC) {
        if (dbtype !== "") {
          downloadDb(data.jobid, dbtype)
        }
        callback(null);
      } else {
        callback(new Error("Job did not complete successfully. Additional diagnostics:" + JSON.stringify(data,null,1)));
      }
    }
  });
}

function compareOutputs(callback) {
  cmd.get('diff "backup/dboutput" "update/dboutput"', function(err, data, stderr) {
  if (stderr) {
      callback(new Error("Could not compare datasets"));
    } else {
      console.log(data);
      callback();
    }
  });
}

/**
* Runs command and calls back without error if successful
* @param {string}           data            command to run
* @param {Array}            expectedOutputs array of expected strings to be in the output
* @param {awaitJobCallback} callback        function to call after completion
*/
function verifyOutput(data, expectedOutputs, callback){
  expectedOutputs.forEach(function(output){
    if (!data.includes(output)) {
      callback(new Error(output + " not found in response: " + data));
    }
  });
  // Success
  callback();
}

function writeDBToFile(dir, fileName, content) {
  // Adjusted to account for Windows filename issues with : in the name.
  var filePath = dir + "/" + fileName;

  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  };
  
  fs.writeFileSync(filePath, content, function(err) {
    if(err) {
      return console.log(err);
    }
  });
}

/**
* Writes content to files
* @param {string}           dir     directory to write content to
* @param {string}           content content to write
*/
function writeToFile(dir, content) {
  // Adjusted to account for Windows filename issues with : in the name.
  var d = new Date(), 
    fileName = d.toISOString().split(":").join("-") + ".txt",
    filePath = dir + "/" + fileName;

  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  };
  
  fs.writeFileSync(filePath, content, function(err) {
    if(err) {
      return console.log(err);
    }
  });
}

gulp.task('db2-backup', 'Backup DB', function (callback) {
  var ds = config.db2QueryJCL;
  submitJobAndDownloadOutput(ds, "jobs/backup-db", 0, "backup", callback);
});

gulp.task('db2-load', "Load DB2 Table", function(callback) {
  submitJobAndDownloadOutput(config.db2LoadJCL, 'jobs/update-ds', 0, "", callback);
});

gulp.task('db2-after', "DB2 After State", function(callback) {
  submitJobAndDownloadOutput(config.db2QueryJCL, "jobs/db2-query", 0, "update", callback);
});

gulp.task('db2-reset', "Reset DB2 Table", function(callback) {
  submitJobAndDownloadOutput(config.db2ResetJCL, 'update', 0, "reset", callback);
});

gulp.task('clean-backup', 'Cleanup Output', function(callback) {
  simpleCommand('rm -rf backup', "command-archive/clean1", callback);
});

gulp.task('clean-jobs', 'Cleanup Output', function(callback) {
  simpleCommand('rm -rf job*', "command-archive/clean2", callback);
});

gulp.task('clean-update', 'Cleanup Output', function(callback) {
  simpleCommand('rm -rf update*', "command-archive/clean2", callback);
});

gulp.task('compare', 'Compare Before and After', function(callback) {
  compareOutputs(callback);
});

gulp.task('clean', 'Cleanup', gulpSequence('clean-backup', 'clean-jobs', 'clean-update'));
gulp.task('update', 'Update Database and DL', gulpSequence('db2-load', 'db2-after'));
gulp.task('all', 'Backup, Update and DL', gulpSequence('db2-backup', 'update'));