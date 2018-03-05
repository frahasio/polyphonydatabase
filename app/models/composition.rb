class Composition < ApplicationRecord
  belongs_to :title
  has_many :inclusions
  has_and_belongs_to_many :composers
end
