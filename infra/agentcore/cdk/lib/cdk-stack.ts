import { AgentCoreApplication, type AgentCoreApplicationProps } from '@aws/agentcore-cdk';
import { Stack, type StackProps, aws_s3 as s3 } from 'aws-cdk-lib';
import { Construct } from 'constructs';

export interface AgentCoreStackProps extends StackProps {
  /** Props for the AgentCore application, produced by transformAgentCoreJson from agentcore/agentcore.json. */
  application: AgentCoreApplicationProps;
}

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

    // El bucket lo crea Terraform (infra/app/almacen.tf); acá solo se referencia por nombre.
    const almacen = s3.Bucket.fromBucketName(this, 'Almacen', `chameleon-almacen-${this.account}`);
    const runtime = this.application.runtime('chameleon');
    runtime.addEnvironmentVariable('AGENTS_STORE', `s3://${almacen.bucketName}/`);
    runtime.grantReadWrite(almacen);
    // El conductor (stage "revision") invoca a este mismo runtime: comodín para no referenciar su propio ARN.
    runtime.grant(
      ['bedrock-agentcore:InvokeAgentRuntime'],
      [`arn:${this.partition}:bedrock-agentcore:${this.region}:${this.account}:runtime/*`],
    );
  }
}
