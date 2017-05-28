class Clef < ActiveRecord::Base
  has_many :clefs_inclusions, inverse_of: :clef
  has_many :inclusions, through: :clefs_inclusions
end
