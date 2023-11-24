/* eslint-disable sonarjs/no-duplicate-string */
import { BadRequestException, Injectable } from '@nestjs/common';
import type {
  IFieldRo,
  IFieldVo,
  IFormulaFieldOptions,
  ILinkFieldOptions,
  ILinkFieldOptionsRo,
  ILookupOptionsRo,
  ILookupOptionsVo,
  IRollupFieldOptions,
  ISelectFieldOptionsRo,
  IUpdateFieldRo,
} from '@teable-group/core';
import {
  ColorUtils,
  generateChoiceId,
  getFormattingSchema,
  getShowAsSchema,
  FIELD_RO_PROPERTIES,
  CellValueType,
  getDefaultFormatting,
  FieldType,
  generateFieldId,
  Relationship,
  RelationshipRevert,
  DbFieldType,
  assertNever,
  SingleLineTextFieldCore,
  NumberFieldCore,
  SelectFieldCore,
  AttachmentFieldCore,
  DateFieldCore,
  CheckboxFieldCore,
  RatingFieldCore,
  LongTextFieldCore,
  isMultiValueLink,
  getRandomString,
} from '@teable-group/core';
import { PrismaService } from '@teable-group/db-main-prisma';
import { Knex } from 'knex';
import { keyBy, merge } from 'lodash';
import { InjectModel } from 'nest-knexjs';
import type { z } from 'zod';
import { fromZodError } from 'zod-validation-error';
import { FieldService } from '../field.service';
import { createFieldInstanceByRaw, createFieldInstanceByVo } from '../model/factory';
import type { IFieldInstance } from '../model/factory';
import { FormulaFieldDto } from '../model/field-dto/formula-field.dto';
import type { LinkFieldDto } from '../model/field-dto/link-field.dto';
import { RollupFieldDto } from '../model/field-dto/rollup-field.dto';

@Injectable()
export class FieldSupplementService {
  constructor(
    @InjectModel('CUSTOM_KNEX') private readonly knex: Knex,
    private readonly fieldService: FieldService,
    private readonly prismaService: PrismaService
  ) {}

  private async getDbTableName(tableId: string) {
    const tableMeta = await this.prismaService.txClient().tableMeta.findUniqueOrThrow({
      where: { id: tableId },
      select: { dbTableName: true },
    });
    return tableMeta.dbTableName;
  }

  private getForeignKeyFieldName(fieldId: string) {
    return `__fk_${fieldId}`;
  }

  private async getDefaultLinkName(foreignTableId: string) {
    const tableRaw = await this.prismaService.tableMeta.findUnique({
      where: { id: foreignTableId },
      select: { name: true },
    });
    if (!tableRaw) {
      throw new BadRequestException(`foreignTableId ${foreignTableId} is invalid`);
    }
    return tableRaw.name;
  }

  async generateNewLinkOptionsVo(
    tableId: string,
    fieldId: string,
    optionsRo: ILinkFieldOptionsRo
  ): Promise<ILinkFieldOptions> {
    const { relationship, foreignTableId, isOneWay } = optionsRo;
    const symmetricFieldId = isOneWay ? undefined : generateFieldId();
    const dbTableName = await this.getDbTableName(tableId);
    const foreignTableName = await this.getDbTableName(foreignTableId);

    const { id: lookupFieldId } = await this.prismaService.field.findFirstOrThrow({
      where: { tableId: foreignTableId, isPrimary: true },
      select: { id: true },
    });

    const common = {
      ...optionsRo,
      symmetricFieldId,
      lookupFieldId,
    };

    if (relationship === Relationship.ManyMany) {
      const pgMaxTableNameLength = 63;
      const fkHostTableName = `junction_${fieldId}_${dbTableName}_${foreignTableName}`.slice(
        0,
        pgMaxTableNameLength
      );
      return {
        ...common,
        fkHostTableName,
        selfKeyName: this.getForeignKeyFieldName(fieldId),
        foreignKeyName: this.getForeignKeyFieldName(
          symmetricFieldId ? symmetricFieldId : `rad${getRandomString(16)}`
        ),
      };
    }

    if (relationship === Relationship.ManyOne) {
      return {
        ...common,
        fkHostTableName: dbTableName,
        selfKeyName: '__id',
        foreignKeyName: this.getForeignKeyFieldName(fieldId),
      };
    }

    if (relationship === Relationship.OneMany) {
      return {
        ...common,
        fkHostTableName: foreignTableName,
        selfKeyName: this.getForeignKeyFieldName(symmetricFieldId ? symmetricFieldId : dbTableName),
        foreignKeyName: '__id',
      };
    }

    if (relationship === Relationship.OneOne) {
      return {
        ...common,
        fkHostTableName: dbTableName,
        selfKeyName: '__id',
        foreignKeyName: this.getForeignKeyFieldName(fieldId),
      };
    }

    throw new BadRequestException('relationship is invalid');
  }

  async generateUpdatedLinkOptionsVo(
    tableId: string,
    fieldId: string,
    oldOptions: ILinkFieldOptions,
    newOptionsRo: ILinkFieldOptionsRo
  ): Promise<ILinkFieldOptions> {
    const { relationship, foreignTableId, isOneWay } = newOptionsRo;

    const dbTableName = await this.getDbTableName(tableId);
    const foreignTableName = await this.getDbTableName(foreignTableId);

    const symmetricFieldId = isOneWay
      ? undefined
      : oldOptions.foreignTableId === newOptionsRo.foreignTableId
      ? oldOptions.symmetricFieldId
      : generateFieldId();

    const lookupFieldId =
      oldOptions.foreignTableId === foreignTableId
        ? oldOptions.lookupFieldId
        : (
            await this.prismaService.field.findFirstOrThrow({
              where: { tableId: foreignTableId, isPrimary: true, deletedTime: null },
              select: { id: true },
            })
          ).id;

    const common = {
      ...newOptionsRo,
      symmetricFieldId,
      lookupFieldId,
    };

    if (relationship === Relationship.ManyMany) {
      const pgMaxTableNameLength = 63;
      const fkHostTableName = `junction_${fieldId}_${dbTableName}_${foreignTableName}`.slice(
        0,
        pgMaxTableNameLength
      );
      return {
        ...common,
        fkHostTableName,
        selfKeyName: this.getForeignKeyFieldName(fieldId),
        foreignKeyName: this.getForeignKeyFieldName(
          symmetricFieldId ? symmetricFieldId : `rad${getRandomString(16)}`
        ),
      };
    }

    if (relationship === Relationship.ManyOne) {
      return {
        ...common,
        fkHostTableName: dbTableName,
        selfKeyName: '__id',
        foreignKeyName: this.getForeignKeyFieldName(fieldId),
      };
    }

    if (relationship === Relationship.OneMany) {
      return {
        ...common,
        fkHostTableName: foreignTableName,
        selfKeyName: this.getForeignKeyFieldName(symmetricFieldId ? symmetricFieldId : dbTableName),
        foreignKeyName: '__id',
      };
    }

    if (relationship === Relationship.OneOne) {
      return {
        ...common,
        fkHostTableName: dbTableName,
        selfKeyName: '__id',
        foreignKeyName: this.getForeignKeyFieldName(fieldId),
      };
    }

    throw new BadRequestException('relationship is invalid');
  }

  private async prepareLinkField(tableId: string, field: IFieldRo) {
    const options = field.options as ILinkFieldOptionsRo;
    const { relationship, foreignTableId } = options;

    const fieldId = field.id ?? generateFieldId();
    const optionsVo = await this.generateNewLinkOptionsVo(tableId, fieldId, options);

    return {
      ...field,
      id: fieldId,
      name: field.name ?? (await this.getDefaultLinkName(foreignTableId)),
      options: optionsVo,
      isMultipleCellValue: isMultiValueLink(relationship),
      dbFieldType: DbFieldType.Json,
      cellValueType: CellValueType.String,
    };
  }

  // only for linkField to linkField
  private async prepareUpdateLinkField(tableId: string, fieldRo: IFieldRo, oldFieldVo: IFieldVo) {
    const newOptionsRo = fieldRo.options as ILinkFieldOptionsRo;
    const oldOptions = oldFieldVo.options as ILinkFieldOptions;
    if (
      oldOptions.foreignTableId === newOptionsRo.foreignTableId &&
      oldOptions.relationship === newOptionsRo.relationship
    ) {
      return {
        ...oldFieldVo,
        ...fieldRo,
        options: {
          ...oldOptions,
          ...newOptionsRo,
          symmetricFieldId: newOptionsRo.isOneWay ? undefined : oldOptions.symmetricFieldId,
        },
      };
    }

    const fieldId = oldFieldVo.id;

    const optionsVo = await this.generateUpdatedLinkOptionsVo(
      tableId,
      fieldId,
      oldOptions,
      newOptionsRo
    );

    return {
      ...oldFieldVo,
      ...fieldRo,
      options: optionsVo,
      isMultipleCellValue: isMultiValueLink(optionsVo.relationship),
      dbFieldType: DbFieldType.Json,
      cellValueType: CellValueType.String,
    };
  }

  private async prepareLookupOptions(field: IFieldRo, batchFieldVos?: IFieldVo[]) {
    const { lookupOptions } = field;
    if (!lookupOptions) {
      throw new BadRequestException('lookupOptions is required');
    }

    const { linkFieldId, lookupFieldId, foreignTableId } = lookupOptions;
    const linkFieldRaw = await this.prismaService.field.findFirst({
      where: { id: linkFieldId, deletedTime: null, type: FieldType.Link },
      select: { name: true, options: true, isMultipleCellValue: true },
    });

    const optionsRaw = linkFieldRaw?.options || null;
    const linkFieldOptions: ILinkFieldOptions =
      (optionsRaw && JSON.parse(optionsRaw as string)) ||
      batchFieldVos?.find((field) => field.id === linkFieldId)?.options;

    if (!linkFieldOptions || !linkFieldRaw) {
      throw new BadRequestException(`linkFieldId ${linkFieldId} is invalid`);
    }

    if (foreignTableId !== linkFieldOptions.foreignTableId) {
      throw new BadRequestException(`foreignTableId ${foreignTableId} is invalid`);
    }

    const lookupFieldRaw = await this.prismaService.field.findFirst({
      where: { id: lookupFieldId, deletedTime: null },
    });

    if (!lookupFieldRaw) {
      throw new BadRequestException(`Lookup field ${lookupFieldId} is not exist`);
    }

    return {
      lookupOptions: {
        linkFieldId,
        lookupFieldId,
        foreignTableId,
        relationship: linkFieldOptions.relationship,
        fkHostTableName: linkFieldOptions.fkHostTableName,
        selfKeyName: linkFieldOptions.selfKeyName,
        foreignKeyName: linkFieldOptions.foreignKeyName,
      },
      lookupFieldRaw,
      linkFieldRaw,
    };
  }

  getDbFieldType(
    fieldType: FieldType,
    cellValueType: CellValueType,
    isMultipleCellValue?: boolean
  ) {
    if (isMultipleCellValue) {
      return DbFieldType.Json;
    }

    if (fieldType === FieldType.Link) {
      return DbFieldType.Json;
    }

    switch (cellValueType) {
      case CellValueType.Number:
        return DbFieldType.Real;
      case CellValueType.DateTime:
        return DbFieldType.DateTime;
      case CellValueType.Boolean:
        return DbFieldType.Boolean;
      case CellValueType.String:
        return DbFieldType.Text;
      default:
        assertNever(cellValueType);
    }
  }

  private prepareFormattingShowAs(
    options: IFieldRo['options'] = {},
    sourceOptions: IFieldVo['options'],
    cellValueType: CellValueType,
    isMultipleCellValue?: boolean
  ) {
    const sourceFormatting = 'formatting' in sourceOptions ? sourceOptions.formatting : undefined;
    const showAsSchema = getShowAsSchema(cellValueType, isMultipleCellValue);
    let sourceShowAs = 'showAs' in sourceOptions ? sourceOptions.showAs : undefined;

    // if source showAs is invalid, we should ignore it
    if (sourceShowAs && !showAsSchema.safeParse(sourceShowAs).success) {
      sourceShowAs = undefined;
    }

    const formatting =
      'formatting' in options
        ? options.formatting
        : sourceFormatting
        ? sourceFormatting
        : getDefaultFormatting(cellValueType);

    const showAs = 'showAs' in options ? options.showAs : sourceShowAs;

    return {
      ...sourceOptions,
      ...(formatting ? { formatting } : {}),
      ...(showAs ? { showAs } : {}),
    };
  }

  private async prepareLookupField(fieldRo: IFieldRo, batchFieldVos?: IFieldVo[]) {
    const { lookupOptions, lookupFieldRaw, linkFieldRaw } = await this.prepareLookupOptions(
      fieldRo,
      batchFieldVos
    );

    if (lookupFieldRaw.type !== fieldRo.type) {
      throw new BadRequestException(
        `Current field type ${fieldRo.type} is not equal to lookup field (${lookupFieldRaw.type})`
      );
    }

    const isMultipleCellValue =
      linkFieldRaw.isMultipleCellValue || lookupFieldRaw.isMultipleCellValue || false;

    const cellValueType = lookupFieldRaw.cellValueType as CellValueType;

    const options = this.prepareFormattingShowAs(
      fieldRo.options,
      JSON.parse(lookupFieldRaw.options as string),
      cellValueType,
      isMultipleCellValue
    );

    return {
      ...fieldRo,
      name: fieldRo.name ?? `${lookupFieldRaw.name} (from ${linkFieldRaw.name})`,
      options,
      lookupOptions,
      isMultipleCellValue,
      isComputed: true,
      cellValueType,
      dbFieldType: this.getDbFieldType(fieldRo.type, cellValueType, isMultipleCellValue),
    };
  }

  private async prepareUpdateLookupField(fieldRo: IFieldRo, oldFieldVo: IFieldVo) {
    const newLookupOptions = fieldRo.lookupOptions as ILookupOptionsRo;
    const oldLookupOptions = oldFieldVo.lookupOptions as ILookupOptionsVo;
    if (
      oldFieldVo.isLookup &&
      newLookupOptions.lookupFieldId === oldLookupOptions.lookupFieldId &&
      newLookupOptions.linkFieldId === oldLookupOptions.linkFieldId &&
      newLookupOptions.foreignTableId === oldLookupOptions.foreignTableId
    ) {
      return merge({}, oldFieldVo, fieldRo);
    }

    return this.prepareLookupField(fieldRo);
  }

  private async prepareFormulaField(fieldRo: IFieldRo, batchFieldVos?: IFieldVo[]) {
    let fieldIds;
    try {
      fieldIds = FormulaFieldDto.getReferenceFieldIds(
        (fieldRo.options as IFormulaFieldOptions).expression
      );
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (e: any) {
      throw new BadRequestException('expression parse error');
    }

    const fieldRaws = await this.prismaService.field.findMany({
      where: { id: { in: fieldIds }, deletedTime: null },
    });

    const fields = fieldRaws.map((fieldRaw) => createFieldInstanceByRaw(fieldRaw));
    const batchFields = batchFieldVos?.map((fieldVo) => createFieldInstanceByVo(fieldVo));
    const fieldMap = keyBy(fields.concat(batchFields || []), 'id');

    if (fieldIds.find((id) => !fieldMap[id])) {
      throw new BadRequestException(`formula field reference ${fieldIds.join()} not found`);
    }

    const { cellValueType, isMultipleCellValue } = FormulaFieldDto.getParsedValueType(
      (fieldRo.options as IFormulaFieldOptions).expression,
      fieldMap
    );

    const formatting =
      (fieldRo.options as IFormulaFieldOptions)?.formatting ?? getDefaultFormatting(cellValueType);

    return {
      ...fieldRo,
      name: fieldRo.name ?? 'Calculation',
      options: {
        ...fieldRo.options,
        ...(formatting ? { formatting } : {}),
      },
      cellValueType,
      isMultipleCellValue,
      isComputed: true,
      dbFieldType: this.getDbFieldType(
        fieldRo.type,
        cellValueType as CellValueType,
        isMultipleCellValue
      ),
    };
  }

  private async prepareUpdateFormulaField(fieldRo: IFieldRo, oldFieldVo: IFieldVo) {
    const newOptions = fieldRo.options as IFormulaFieldOptions;
    const oldOptions = oldFieldVo.options as IFormulaFieldOptions;

    if (newOptions.expression === oldOptions.expression) {
      return merge({}, oldFieldVo, fieldRo);
    }

    return this.prepareFormulaField(fieldRo);
  }

  private async prepareRollupField(field: IFieldRo, batchFieldVos?: IFieldVo[]) {
    const { lookupOptions, linkFieldRaw, lookupFieldRaw } = await this.prepareLookupOptions(
      field,
      batchFieldVos
    );
    const options = field.options as IRollupFieldOptions;
    const lookupField = createFieldInstanceByRaw(lookupFieldRaw);
    if (!options) {
      throw new BadRequestException('rollup field options is required');
    }

    let valueType;
    try {
      valueType = RollupFieldDto.getParsedValueType(
        options.expression,
        lookupField,
        lookupField.isMultipleCellValue || linkFieldRaw.isMultipleCellValue || false
      );
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (e: any) {
      throw new BadRequestException(`Parse rollUp Error: ${e.message}`);
    }

    const { cellValueType, isMultipleCellValue } = valueType;

    const formatting = options.formatting ?? getDefaultFormatting(cellValueType);

    return {
      ...field,
      name: field.name ?? `${lookupFieldRaw.name} Rollup (from ${linkFieldRaw.name})`,
      options: {
        ...options,
        ...(formatting ? { formatting } : {}),
      },
      lookupOptions,
      cellValueType,
      isComputed: true,
      isMultipleCellValue,
      dbFieldType: this.getDbFieldType(
        field.type,
        cellValueType as CellValueType,
        isMultipleCellValue
      ),
    };
  }

  private async prepareUpdateRollupField(fieldRo: IFieldRo, oldFieldVo: IFieldVo) {
    const newOptions = fieldRo.options as IRollupFieldOptions;
    const oldOptions = oldFieldVo.options as IRollupFieldOptions;

    const newLookupOptions = fieldRo.lookupOptions as ILookupOptionsRo;
    const oldLookupOptions = oldFieldVo.lookupOptions as ILookupOptionsVo;
    if (
      newOptions.expression === oldOptions.expression &&
      newLookupOptions.lookupFieldId === oldLookupOptions.lookupFieldId &&
      newLookupOptions.linkFieldId === oldLookupOptions.linkFieldId &&
      newLookupOptions.foreignTableId === oldLookupOptions.foreignTableId
    ) {
      return merge({}, oldFieldVo, fieldRo);
    }

    return this.prepareRollupField(fieldRo);
  }

  private prepareSingleTextField(field: IFieldRo) {
    const { name, options } = field;

    return {
      ...field,
      name: name ?? 'Label',
      options: options ?? SingleLineTextFieldCore.defaultOptions(),
      cellValueType: CellValueType.String,
      dbFieldType: DbFieldType.Text,
    };
  }

  private prepareLongTextField(field: IFieldRo) {
    const { name, options } = field;

    return {
      ...field,
      name: name ?? 'Notes',
      options: options ?? LongTextFieldCore.defaultOptions(),
      cellValueType: CellValueType.String,
      dbFieldType: DbFieldType.Text,
    };
  }

  private prepareNumberField(field: IFieldRo) {
    const { name, options } = field;

    return {
      ...field,
      name: name ?? 'Number',
      options: options ?? NumberFieldCore.defaultOptions(),
      cellValueType: CellValueType.Number,
      dbFieldType: DbFieldType.Real,
    };
  }

  private prepareRatingField(field: IFieldRo) {
    const { name, options } = field;

    return {
      ...field,
      name: name ?? 'Rating',
      options: options ?? RatingFieldCore.defaultOptions(),
      cellValueType: CellValueType.Number,
      dbFieldType: DbFieldType.Integer,
    };
  }

  private prepareSelectOptions(options: ISelectFieldOptionsRo) {
    const optionsRo = (options ?? SelectFieldCore.defaultOptions()) as ISelectFieldOptionsRo;
    const nameSet = new Set<string>();
    return {
      ...optionsRo,
      choices: optionsRo.choices.map((choice) => {
        if (nameSet.has(choice.name)) {
          throw new BadRequestException(`choice name ${choice.name} is duplicated`);
        }
        nameSet.add(choice.name);
        return {
          name: choice.name,
          id: choice.id ?? generateChoiceId(),
          color: choice.color ?? ColorUtils.randomColor()[0],
        };
      }),
    };
  }

  private prepareSingleSelectField(field: IFieldRo) {
    const { name, options } = field;

    return {
      ...field,
      name: name ?? 'Select',
      options: this.prepareSelectOptions(options as ISelectFieldOptionsRo),
      cellValueType: CellValueType.String,
      dbFieldType: DbFieldType.Text,
    };
  }

  private prepareMultipleSelectField(field: IFieldRo) {
    const { name, options } = field;

    return {
      ...field,
      name: name ?? 'Tags',
      options: this.prepareSelectOptions(options as ISelectFieldOptionsRo),
      cellValueType: CellValueType.String,
      dbFieldType: DbFieldType.Json,
      isMultipleCellValue: true,
    };
  }

  private prepareAttachmentField(field: IFieldRo) {
    const { name, options } = field;

    return {
      ...field,
      name: name ?? 'Attachments',
      options: options ?? AttachmentFieldCore.defaultOptions(),
      cellValueType: CellValueType.String,
      dbFieldType: DbFieldType.Json,
      isMultipleCellValue: true,
    };
  }

  private prepareDateField(field: IFieldRo) {
    const { name, options } = field;

    return {
      ...field,
      name: name ?? 'Date',
      options: options ?? DateFieldCore.defaultOptions(),
      cellValueType: CellValueType.DateTime,
      dbFieldType: DbFieldType.DateTime,
    };
  }

  private prepareCheckboxField(field: IFieldRo) {
    const { name, options } = field;

    return {
      ...field,
      name: name ?? 'Done',
      options: options ?? CheckboxFieldCore.defaultOptions(),
      cellValueType: CellValueType.Boolean,
      dbFieldType: DbFieldType.Boolean,
    };
  }

  private async prepareCreateFieldInner(
    tableId: string,
    fieldRo: IFieldRo,
    batchFieldVos?: IFieldVo[]
  ) {
    if (fieldRo.isLookup) {
      return this.prepareLookupField(fieldRo, batchFieldVos);
    }

    switch (fieldRo.type) {
      case FieldType.Link:
        return this.prepareLinkField(tableId, fieldRo);
      case FieldType.Rollup:
        return this.prepareRollupField(fieldRo, batchFieldVos);
      case FieldType.Formula:
        return this.prepareFormulaField(fieldRo, batchFieldVos);
      case FieldType.SingleLineText:
        return this.prepareSingleTextField(fieldRo);
      case FieldType.LongText:
        return this.prepareLongTextField(fieldRo);
      case FieldType.Number:
        return this.prepareNumberField(fieldRo);
      case FieldType.Rating:
        return this.prepareRatingField(fieldRo);
      case FieldType.SingleSelect:
        return this.prepareSingleSelectField(fieldRo);
      case FieldType.MultipleSelect:
        return this.prepareMultipleSelectField(fieldRo);
      case FieldType.Attachment:
        return this.prepareAttachmentField(fieldRo);
      case FieldType.Date:
        return this.prepareDateField(fieldRo);
      case FieldType.Checkbox:
        return this.prepareCheckboxField(fieldRo);
      default:
        throw new Error('invalid field type');
    }
  }

  private async prepareUpdateFieldInner(tableId: string, fieldRo: IFieldRo, oldFieldVo: IFieldVo) {
    if (fieldRo.type !== oldFieldVo.type) {
      return this.prepareCreateFieldInner(tableId, fieldRo);
    }

    if (fieldRo.isLookup) {
      return this.prepareUpdateLookupField(fieldRo, oldFieldVo);
    }

    switch (fieldRo.type) {
      case FieldType.Link: {
        return this.prepareUpdateLinkField(tableId, fieldRo, oldFieldVo);
      }
      case FieldType.Rollup:
        return this.prepareUpdateRollupField(fieldRo, oldFieldVo);
      case FieldType.Formula:
        return this.prepareUpdateFormulaField(fieldRo, oldFieldVo);
      case FieldType.SingleLineText:
        return this.prepareSingleTextField(fieldRo);
      case FieldType.LongText:
        return this.prepareLongTextField(fieldRo);
      case FieldType.Number:
        return this.prepareNumberField(fieldRo);
      case FieldType.Rating:
        return this.prepareRatingField(fieldRo);
      case FieldType.SingleSelect:
        return this.prepareSingleSelectField(fieldRo);
      case FieldType.MultipleSelect:
        return this.prepareMultipleSelectField(fieldRo);
      case FieldType.Attachment:
        return this.prepareAttachmentField(fieldRo);
      case FieldType.Date:
        return this.prepareDateField(fieldRo);
      case FieldType.Checkbox:
        return this.prepareCheckboxField(fieldRo);
      default:
        throw new Error('invalid field type');
    }
  }

  private zodParse(schema: z.Schema, value: unknown) {
    const result = (schema as z.Schema).safeParse(value);

    if (!result.success) {
      throw new BadRequestException(fromZodError(result.error));
    }
  }

  private validateFormattingShowAs(field: IFieldVo) {
    const { cellValueType, isMultipleCellValue } = field;
    const showAsSchema = getShowAsSchema(cellValueType, isMultipleCellValue);

    const showAs = 'showAs' in field.options ? field.options.showAs : undefined;
    const formatting = 'formatting' in field.options ? field.options.formatting : undefined;

    if (showAs) {
      this.zodParse(showAsSchema, showAs);
    }

    if (formatting) {
      const formattingSchema = getFormattingSchema(cellValueType);
      this.zodParse(formattingSchema, formatting);
    }
  }
  /**
   * prepare properties for computed field to make sure it's valid
   * this method do not do any db update
   */
  async prepareCreateField(tableId: string, fieldRo: IFieldRo, batchFieldVos?: IFieldVo[]) {
    const field = await this.prepareCreateFieldInner(tableId, fieldRo, batchFieldVos);

    const fieldId = field.id || generateFieldId();

    const dbFieldName = this.fieldService.generateDbFieldName([
      { id: fieldId, name: field.name },
    ])[0];

    const fieldVo = {
      ...field,
      id: fieldId,
      dbFieldName,
    } as IFieldVo;

    this.validateFormattingShowAs(fieldVo);

    return fieldVo;
  }

  async prepareUpdateField(tableId: string, fieldRo: IUpdateFieldRo, oldField: IFieldInstance) {
    // make sure all keys in FIELD_RO_PROPERTIES are define, so we can override old value.
    FIELD_RO_PROPERTIES.forEach(
      (key) => !fieldRo[key] && ((fieldRo as Record<string, unknown>)[key] = undefined)
    );

    const fieldVo = (await this.prepareUpdateFieldInner(
      tableId,
      { ...fieldRo, name: fieldRo.name ?? oldField.name }, // for convenience, we fallback name when it be undefined
      oldField
    )) as IFieldVo;

    this.validateFormattingShowAs(fieldVo);

    return {
      ...fieldVo,
      id: oldField.id,
      dbFieldName: oldField.dbFieldName,
      isPrimary: oldField.isPrimary,
      columnMeta: fieldVo.columnMeta ?? oldField.columnMeta,
    };
  }

  async generateSymmetricField(tableId: string, field: LinkFieldDto) {
    if (!field.options.symmetricFieldId) {
      throw new Error('symmetricFieldId is required');
    }

    const prisma = this.prismaService.txClient();
    const { name: tableName } = await prisma.tableMeta.findUniqueOrThrow({
      where: { id: tableId },
      select: { name: true },
    });

    // lookup field id is the primary field of the table to which it is linked
    const { id: lookupFieldId } = await prisma.field.findFirstOrThrow({
      where: { tableId, isPrimary: true },
      select: { id: true },
    });

    const relationship = RelationshipRevert[field.options.relationship];
    const isMultipleCellValue = isMultiValueLink(relationship);
    const [dbFieldName] = this.fieldService.generateDbFieldName([
      { id: field.options.symmetricFieldId, name: tableName },
    ]);

    return createFieldInstanceByVo({
      id: field.options.symmetricFieldId,
      name: tableName,
      dbFieldName,
      type: FieldType.Link,
      options: {
        relationship,
        foreignTableId: tableId,
        lookupFieldId,
        fkHostTableName: field.options.fkHostTableName,
        selfKeyName: field.options.foreignKeyName,
        foreignKeyName: field.options.selfKeyName,
        symmetricFieldId: field.id,
      },
      isMultipleCellValue,
      dbFieldType: DbFieldType.Json,
      cellValueType: CellValueType.String,
    } as IFieldVo) as LinkFieldDto;
  }

  async createForeignKey(options: ILinkFieldOptions) {
    const { relationship, fkHostTableName, selfKeyName, foreignKeyName } = options;

    let alterTableSchema: Knex.SchemaBuilder | undefined;

    if (relationship === Relationship.ManyMany) {
      alterTableSchema = this.knex.schema.createTable(fkHostTableName, (table) => {
        table.increments('__id').primary();
        table.string(selfKeyName);
        table.string(foreignKeyName);
        table.unique([selfKeyName, foreignKeyName], {
          indexName: `index_${selfKeyName}_${foreignKeyName}`,
        });
      });
    }

    if (relationship === Relationship.ManyOne) {
      alterTableSchema = this.knex.schema.alterTable(fkHostTableName, (table) => {
        table.string(foreignKeyName);
        console.log('createIndex', `index_${foreignKeyName}`);
        table.index([foreignKeyName], `index_${foreignKeyName}`);
      });
    }

    if (relationship === Relationship.OneMany) {
      alterTableSchema = this.knex.schema.alterTable(fkHostTableName, (table) => {
        table.string(selfKeyName);
        table.index([selfKeyName], `index_${selfKeyName}`);
      });
    }

    // assume options is from the main field (user created one)
    if (relationship === Relationship.OneOne) {
      alterTableSchema = this.knex.schema.alterTable(fkHostTableName, (table) => {
        if (foreignKeyName === '__id') {
          throw new Error('can not use __id for foreignKeyName');
        }
        table.string(foreignKeyName);
        table.unique([foreignKeyName], {
          indexName: `index_${foreignKeyName}`,
        });
      });
    }

    if (!alterTableSchema) {
      throw new Error('alterTableSchema is undefined');
    }

    for (const sql of alterTableSchema.toSQL()) {
      await this.prismaService.txClient().$executeRawUnsafe(sql.sql);
    }
  }

  async cleanForeignKey(options: ILinkFieldOptions) {
    const { fkHostTableName, relationship, selfKeyName, foreignKeyName } = options;

    if (relationship === Relationship.ManyMany) {
      const alterTableSchema = this.knex.schema.dropTable(fkHostTableName);

      for (const sql of alterTableSchema.toSQL()) {
        await this.prismaService.txClient().$executeRawUnsafe(sql.sql);
      }
      return;
    }

    const dropColumn = async (tableName: string, columnName: string) => {
      const dropIndexSql = this.knex
        .queryBuilder()
        .dropIndex(tableName, `index_${columnName}`)
        .toQuery();
      const dropColumnSql = this.knex
        .raw(`ALTER TABLE ?? DROP ??`, [tableName, columnName])
        .toQuery();

      await this.prismaService.txClient().$executeRawUnsafe(dropIndexSql);
      await this.prismaService.txClient().$executeRawUnsafe(dropColumnSql);
    };

    if (relationship === Relationship.ManyOne) {
      await dropColumn(fkHostTableName, foreignKeyName);
    }

    if (relationship === Relationship.OneMany) {
      await dropColumn(fkHostTableName, selfKeyName);
    }

    if (relationship === Relationship.OneOne) {
      await dropColumn(fkHostTableName, foreignKeyName === '__id' ? selfKeyName : foreignKeyName);
    }
  }

  async createReference(field: IFieldInstance) {
    if (field.isLookup) {
      return await this.createLookupReference(field);
    }

    switch (field.type) {
      case FieldType.Formula:
        return await this.createFormulaReference(field);
      case FieldType.Rollup:
        // rollup use same reference logic as lookup
        return await this.createLookupReference(field);
      case FieldType.Link:
        return await this.createLinkReference(field);
      default:
        break;
    }
  }

  async deleteReference(fieldId: string): Promise<string[]> {
    const prisma = this.prismaService.txClient();
    const refRaw = await prisma.reference.findMany({
      where: {
        fromFieldId: fieldId,
      },
    });

    await prisma.reference.deleteMany({
      where: {
        OR: [{ toFieldId: fieldId }, { fromFieldId: fieldId }],
      },
    });

    return refRaw.map((ref) => ref.toFieldId);
  }

  /**
   * the lookup field that attach to the deleted, should delete to field reference
   */
  async deleteLookupFieldReference(linkFieldId: string): Promise<string[]> {
    const prisma = this.prismaService.txClient();
    const fieldsRaw = await prisma.field.findMany({
      where: { lookupLinkedFieldId: linkFieldId, deletedTime: null },
      select: { id: true },
    });
    const lookupFieldIds = fieldsRaw.map((field) => field.id);

    // just need delete to field id, because lookup field still exist
    await prisma.reference.deleteMany({
      where: {
        OR: [{ toFieldId: { in: lookupFieldIds } }],
      },
    });
    return lookupFieldIds;
  }

  private async createLookupReference(field: IFieldInstance) {
    const toFieldId = field.id;
    if (!field.lookupOptions) {
      throw new Error('lookupOptions is required');
    }
    const { lookupFieldId } = field.lookupOptions;

    await this.prismaService.txClient().reference.create({
      data: {
        fromFieldId: lookupFieldId,
        toFieldId,
      },
    });
  }

  private async createLinkReference(field: LinkFieldDto) {
    const toFieldId = field.id;
    const fromFieldId = field.options.lookupFieldId;

    await this.prismaService.txClient().reference.create({
      data: {
        fromFieldId,
        toFieldId,
      },
    });
  }

  private async createFormulaReference(field: FormulaFieldDto) {
    const fieldIds = field.getReferenceFieldIds();
    const toFieldId = field.id;

    for (const fromFieldId of fieldIds) {
      await this.prismaService.txClient().reference.create({
        data: {
          fromFieldId,
          toFieldId,
        },
      });
    }
  }
}