export interface FunctionAbi {
  /**
   * The name of the function.
   */
  name: string;
  /**
   * Whether the function is secret.
   */
  functionType: FunctionType;
  /**
   * Whether the function is internal.
   */
  isInternal: boolean;
  /**
   * Whether the function can alter state or not
   */
  isStatic: boolean;
  /**
   * Function parameters.
   */
  parameters: ABIParameter[];
  /**
   * The types of the return values.
   */
  returnTypes: AbiType[];
  /**
   * Whether the function is flagged as an initializer.
   */
  isInitializer: boolean;
}

export enum FunctionType {
  PRIVATE = 'private',
  PUBLIC = 'public',
  UNCONSTRAINED = 'unconstrained',
}

export interface ABIVariable {
  /**
   * The name of the variable.
   */
  name: string;
  /**
   * The type of the variable.
   */
  type: AbiType;
}

/**
 * Indicates whether a parameter is public or secret/private.
 */
export type ABIParameterVisibility = 'public' | 'private' | 'databus';

/**
 * A function parameter.
 */
export interface ABIParameter extends ABIVariable {
  /**
   * Indicates whether a parameter is public or secret/private.
   */
  visibility: ABIParameterVisibility;
}

export interface BasicType<T extends string> {
  /**
   * The kind of the type.
   */
  kind: T;
}

export type AbiType =
  | BasicType<'field'>
  | BasicType<'boolean'>
  | IntegerType
  | ArrayType
  | StringType
  | StructType
  | TupleType;

type Sign = 'unsigned' | 'signed';

/**
 * An integer type.
 */
export interface IntegerType extends BasicType<'integer'> {
  /**
   * The sign of the integer.
   */
  sign: Sign;
  /**
   * The width of the integer in bits.
   */
  width: number;
}

/**
 * An array type.
 */
export interface ArrayType extends BasicType<'array'> {
  /**
   * The length of the array.
   */
  length: number;
  /**
   * The type of the array elements.
   */
  type: AbiType;
}

/**
 * A tuple type.
 */
export interface TupleType extends BasicType<'tuple'> {
  /**
   * The types of the tuple elements.
   */
  fields: AbiType[];
}

/**
 * A string type.
 */
export interface StringType extends BasicType<'string'> {
  /**
   * The length of the string.
   */
  length: number;
}

/**
 * A struct type.
 */
export interface StructType extends BasicType<'struct'> {
  /**
   * The fields of the struct.
   */
  fields: ABIVariable[];
  /**
   * Fully qualified name of the struct.
   */
  path: string;
}