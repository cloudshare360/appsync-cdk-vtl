import cdk = require('aws-cdk-lib');
import { Construct } from 'constructs';
import { Stack, StackProps } from 'aws-cdk-lib';
import { CfnOutput, RemovalPolicy } from 'aws-cdk-lib';
import { CfnGraphQLApi, CfnApiKey, CfnGraphQLSchema, CfnDataSource, CfnResolver } from 'aws-cdk-lib/aws-appsync';
import { AttributeType, BillingMode,StreamViewType, Table } from 'aws-cdk-lib/aws-dynamodb';
import { RetentionDays } from 'aws-cdk-lib/aws-logs';
import { Role, ServicePrincipal, ManagedPolicy } from 'aws-cdk-lib/aws-iam';
import * as appsync from "@aws-cdk/aws-appsync";
export class NoteServiceStack extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    const tableName = 'items'

    const itemsGraphQLApi = new CfnGraphQLApi(this, 'ItemsApi', {
      name: 'items-api',
      authenticationType: 'API_KEY'
    });

    new CfnApiKey(this, 'ItemsApiKey', {
      apiId: itemsGraphQLApi.attrApiId
    });

    const apiSchema = new CfnGraphQLSchema(this, 'ItemsSchema', {
      apiId: itemsGraphQLApi.attrApiId,
      definition: `type ${tableName} {
        ${tableName}Id: ID!
        name: String
      }
      type Paginated${tableName} {
        items: [${tableName}!]!
        nextToken: String
      }
      type Query {
        all(limit: Int, nextToken: String): Paginated${tableName}!
        getOne(${tableName}Id: ID!): ${tableName}
      }
      type Mutation {
        save(name: String!): ${tableName}
        delete(${tableName}Id: ID!): ${tableName}
      }
      type Schema {
        query: Query
        mutation: Mutation
      }`
    });


    const itemsTable = new Table(this, 'ItemsTable', {
      tableName: tableName,
      partitionKey: {
        name: `${tableName}Id`,
        type: AttributeType.STRING
      },
      billingMode: BillingMode.PAY_PER_REQUEST,
      stream: StreamViewType.NEW_IMAGE,

      // The default removal policy is RETAIN, which means that cdk destroy will not attempt to delete
      // the new table, and it will remain in your account until manually deleted. By setting the policy to
      // DESTROY, cdk destroy will delete the table (even if it has data in it)
      removalPolicy: cdk.RemovalPolicy.DESTROY, // NOT recommended for production code
    });

    const itemsTableRole = new Role(this, 'ItemsDynamoDBRole', {
      assumedBy: new ServicePrincipal('appsync.amazonaws.com')
    });

    itemsTableRole.addManagedPolicy(ManagedPolicy.fromAwsManagedPolicyName('AmazonDynamoDBFullAccess'));
    itemsTableRole.addManagedPolicy(ManagedPolicy.fromAwsManagedPolicyName('AmazonDynamoDBFullAccess'));

    const dataSource = new CfnDataSource(this, 'ItemsDataSource', {
      apiId: itemsGraphQLApi.attrApiId,
      name: 'ItemsDynamoDataSource',
      type: 'AMAZON_DYNAMODB',
      dynamoDbConfig: {
        tableName: itemsTable.tableName,
        awsRegion: this.region
      },
      serviceRoleArn: itemsTableRole.roleArn
    });

    const getOneResolver = new CfnResolver(this, 'GetOneQueryResolver', {
      apiId: itemsGraphQLApi.attrApiId,
      typeName: 'Query',
      fieldName: 'getOne',
      dataSourceName: dataSource.name,
      requestMappingTemplate: `{
        "version": "2017-02-28",
        "operation": "GetItem",
        "key": {
          "${tableName}Id": $util.dynamodb.toDynamoDBJson($ctx.args.${tableName}Id)
        }
      }`,
      responseMappingTemplate: `$util.toJson($ctx.result)`
    });
    getOneResolver.addDependsOn(apiSchema);

    const getAllResolver = new CfnResolver(this, 'GetAllQueryResolver', {
      apiId: itemsGraphQLApi.attrApiId,
      typeName: 'Query',
      fieldName: 'all',
      dataSourceName: dataSource.name,
      requestMappingTemplate: `{
        "version": "2017-02-28",
        "operation": "Scan",
        "limit": $util.defaultIfNull($ctx.args.limit, 20),
        "nextToken": $util.toJson($util.defaultIfNullOrEmpty($ctx.args.nextToken, null))
      }`,
      responseMappingTemplate: `$util.toJson($ctx.result)`
    });
    getAllResolver.addDependsOn(apiSchema);

    const saveResolver = new CfnResolver(this, 'SaveMutationResolver', {
      apiId: itemsGraphQLApi.attrApiId,
      typeName: 'Mutation',
      fieldName: 'save',
      dataSourceName: dataSource.name,
      requestMappingTemplate: `{
        "version": "2017-02-28",
        "operation": "PutItem",
        "key": {
          "${tableName}Id": { "S": "$util.autoId()" }
        },
        "attributeValues": {
          "name": $util.dynamodb.toDynamoDBJson($ctx.args.name)
        }
      }`,
      responseMappingTemplate: `$util.toJson($ctx.result)`
    });
    saveResolver.addDependsOn(apiSchema);

    const deleteResolver = new CfnResolver(this, 'DeleteMutationResolver', {
      apiId: itemsGraphQLApi.attrApiId,
      typeName: 'Mutation',
      fieldName: 'delete',
      dataSourceName: dataSource.name,
      requestMappingTemplate: `{
        "version": "2017-02-28",
        "operation": "DeleteItem",
        "key": {
          "${tableName}Id": $util.dynamodb.toDynamoDBJson($ctx.args.${tableName}Id)
        }
      }`,
      responseMappingTemplate: `$util.toJson($ctx.result)`
    });
    deleteResolver.addDependsOn(apiSchema);

    const table = new Table(this, "dev-msta-tca-reg", {
      tableName: "dev-msta-tca-reg",
      partitionKey: {
        name: 'tcAdminGuid',
        type: AttributeType.STRING
      },
      sortKey: {
        name: 'regId',
        type: AttributeType.STRING
      },
      removalPolicy: RemovalPolicy.RETAIN,
      billingMode: BillingMode.PAY_PER_REQUEST,
      timeToLiveAttribute: 'TTL'
    });

    table.addGlobalSecondaryIndex({
      indexName: "dev-msta-tca-reg" + "-gsi",
      sortKey: {
        name: 'asmtEventId',
        type: AttributeType.NUMBER
      },
      partitionKey: {
        name: 'regId',
        type: AttributeType.STRING
      }
    });

    table.addGlobalSecondaryIndex({
      indexName: "dev-msta-tca-reg" + "-personId-gsi",
      partitionKey: {
        name: 'personId',
        type: AttributeType.STRING
      }
    });

    table.addGlobalSecondaryIndex({
      indexName: "dev-msta-tca-reg" + "-asmtEventId-gsi",
      partitionKey: {
        name: 'asmtEventId',
        type: AttributeType.NUMBER
      }
    });

    table.addGlobalSecondaryIndex({
      indexName: "dev-msta-tca-reg" + "-regNo-gsi",
      partitionKey: {
        name: 'regNo',
        type: AttributeType.STRING
      }
    });

    // ======= configuring dynamodb datasource, resolver for query:getRegInfoByRegNo =======

    const mstaTcaRegDataTbl = Table.fromTableName(
        this,
        "msta-tca-reg",
        "dev-msta-tca-reg"
    );
    const mstaTcaRegDataSrc = new DynamoDbDataSource(
        this,
        "mstaTcaRegDataSrc",
        {
          api: itemsGraphQLApi,
          table: mstaTcaRegDataTbl,
          description: '  msta-tca-reg as datasource',
          name: "mstaTcaRegDataSrc",
          serviceRole: itemsTableRole
        }
    );

    new CfnApiKey(this, 'ItemsApiKey', {
      apiId: itemsGraphQLApi.attrApiId
    });


  }
}

const app = new cdk.App();
new NoteServiceStack(app, 'AppSyncGraphQLDynamoDBExample');
app.synth();


    /**
     * Quick hack to quickly get the GQL API key
     * This will print out the API key to the console, so you probably don't want to do this for security reasons.
     */
    // if (api.apiKey) {
    //   new CfnOutput(this, 'apiKey', {
    //     value: api.apiKey
    //   });
    // }
  

