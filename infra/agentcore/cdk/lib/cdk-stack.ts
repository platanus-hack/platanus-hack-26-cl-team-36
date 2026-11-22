import { AgentCoreApplication, type AgentCoreApplicationProps } from '@aws/agentcore-cdk';
import { Stack, type StackProps, aws_iam as iam } from 'aws-cdk-lib';
import { Construct } from 'constructs';

export interface AgentCoreStackProps extends StackProps {
  /** Props for the AgentCore application, produced by transformAgentCoreJson from agentcore/agentcore.json. */
  application: AgentCoreApplicationProps;
}

// The agent runs bucket and its write policy live in infra/app (corridas.tf): same names here.
const RUNS_NAME = 'chameleon-corridas';

/**
 * The stack the AgentCore CLI deploys. Everything declared in agentcore/agentcore.json is
 * created by the AgentCoreApplication construct. Add your own resources below it and wire
 * them to your runtimes and harnesses through the application's accessors.
 */
export class AgentCoreStack extends Stack {
  public readonly application: AgentCoreApplication;

  constructor(scope: Construct, id: string, props: AgentCoreStackProps) {
    super(scope, id, props);
    this.application = new AgentCoreApplication(this, 'Application', props.application);

    const evaluator = this.application.runtime('web_evaluator_image');
    evaluator.role.addManagedPolicy(
      iam.ManagedPolicy.fromManagedPolicyName(this, 'RunsWrite', `${RUNS_NAME}-escritura`),
    );
    evaluator.addEnvironmentVariable('AGENTS_STORE', `s3://${RUNS_NAME}-${this.account}`);
  }
}
