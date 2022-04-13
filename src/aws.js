const AWS = require('aws-sdk');
const core = require('@actions/core');
const config = require('./config');

// User data scripts are run as the root user
function buildUserDataScript(githubRegistrationToken, label) {
  if (config.input.runnerHomeDir) {
    // If runner home directory is specified, we expect the actions-runner software (and dependencies)
    // to be pre-installed in the AMI, so we simply cd into that directory and then start the runner
    return [
      'Content-Type: multipart/mixed; boundary="//"',
      'MIME-Version: 1.0',

      'Content-Type: text/cloud-config; charset="us-ascii"',
      'MIME-Version: 1.0',
      'Content-Transfer-Encoding: 7bit',
      'Content-Disposition: attachment; filename="cloud-config.txt"',

      '#cloud-config',
      'cloud_final_modules:',
      '- [scripts-user, always]',

      'Content-Type: text/x-shellscript; charset="us-ascii"',
      'MIME-Version: 1.0',
      'Content-Transfer-Encoding: 7bit',
      'Content-Disposition: attachment; filename="userdata.txt"',

      '#!/bin/bash',
      `cd "${config.input.runnerHomeDir}"`,
      'export RUNNER_ALLOW_RUNASROOT=1',
      `./config.sh --url https://github.com/${config.githubContext.owner}/${config.githubContext.repo} --token ${githubRegistrationToken} --labels ${label}`,
      './run.sh',
    ];
  } else {
    return [
      'Content-Type: multipart/mixed; boundary="//"',
      'MIME-Version: 1.0',

      'Content-Type: text/cloud-config; charset="us-ascii"',
      'MIME-Version: 1.0',
      'Content-Transfer-Encoding: 7bit',
      'Content-Disposition: attachment; filename="cloud-config.txt"',

      '#cloud-config',
      'cloud_final_modules:',
      '- [scripts-user, always]',

      'Content-Type: text/x-shellscript; charset="us-ascii"',
      'MIME-Version: 1.0',
      'Content-Transfer-Encoding: 7bit',
      'Content-Disposition: attachment; filename="userdata.txt"',

      '#!/bin/bash',
      'mkdir actions-runner && cd actions-runner',
      'case $(uname -m) in aarch64) ARCH="arm64" ;; amd64|x86_64) ARCH="x64" ;; esac && export RUNNER_ARCH=${ARCH}',
      'curl -O -L https://github.com/actions/runner/releases/download/v2.286.0/actions-runner-linux-${RUNNER_ARCH}-2.286.0.tar.gz',
      'tar xzf ./actions-runner-linux-${RUNNER_ARCH}-2.286.0.tar.gz',
      'export RUNNER_ALLOW_RUNASROOT=1',
      `./config.sh --url https://github.com/${config.githubContext.owner}/${config.githubContext.repo} --token ${githubRegistrationToken} --labels ${label}`,
      './run.sh',
    ];
  }
}

async function startEc2Instance(label, githubRegistrationToken) {
  const ec2 = new AWS.EC2();

  const userData = buildUserDataScript(githubRegistrationToken, label);

  const modifyParams = {
    InstanceId: config.input.ec2InstanceId,
    UserData: {
      Value: Buffer.from(userData.join('\n')),
    },
  };

  try {
    const result = await ec2.modifyInstanceAttribute(modifyParams).promise();
    const ec2InstanceId = result.Instances[0].InstanceId;
    core.info(`User data set for AWS EC2 instance ${ec2InstanceId}`);
  } catch (error) {
    core.error('AWS EC2 instance modify userData error... verify the instance is stopped before running CD');
    throw error;
  }

  const startParams = {
    InstanceIds: [config.input.ec2InstanceId],
  };

  try {
    const result = await ec2.startInstances(startParams).promise();
    const ec2InstanceId = result.Instances[0].InstanceId;
    core.info(`AWS EC2 instance ${ec2InstanceId} is started`);
    return ec2InstanceId;
  } catch (error) {
    core.error('AWS EC2 instance starting error');
    throw error;
  }
}

async function stopEc2Instance() {
  const ec2 = new AWS.EC2();

  const params = {
    InstanceIds: [config.input.ec2InstanceId],
  };

  try {
    await ec2.stopInstances(params).promise();
    core.info(`AWS EC2 instance ${config.input.ec2InstanceId} is stopped`);
    return;
  } catch (error) {
    core.error(`AWS EC2 instance ${config.input.ec2InstanceId} stoppage error`);
    throw error;
  }
}

async function waitForInstanceRunning(ec2InstanceId) {
  const ec2 = new AWS.EC2();

  const params = {
    InstanceIds: [ec2InstanceId],
  };

  try {
    await ec2.waitFor('instanceRunning', params).promise();
    core.info(`AWS EC2 instance ${ec2InstanceId} is up and running`);
    return;
  } catch (error) {
    core.error(`AWS EC2 instance ${ec2InstanceId} initialization error`);
    throw error;
  }
}

module.exports = {
  startEc2Instance,
  stopEc2Instance,
  waitForInstanceRunning,
};
