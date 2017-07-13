class InclusionsController < ApplicationController
  def index
    @grouped_inclusions = UniquePiece.group(Inclusion.all)
    @grouped_inclusions = search(@grouped_inclusions)
  end

private

  def search(grouped_inclusions)
    return grouped_inclusions unless params[:q]

    grouped_inclusions.select { |unique_piece, inclusions|
      [
        unique_piece.title,
        inclusions.first.composers.compact.map(&:aliased_as).join(" | "),
        inclusions.first.composers.compact.map(&:name).join(" | "),
        inclusions.map(&:source).compact.map(&:title).join(" | "),
        inclusions.map(&:source).compact.map(&:code).join(" | "),
        inclusions.map(&:source).compact.map(&:location_and_pubscribe).join(" | "),
        inclusions.map(&:source).compact.map(&:dates).join(" | "),
        inclusions.map(&:source).compact.map(&:type).join(" | "),
      ].any? { |string| string.include?(params[:q]) }
    }
  end
end
