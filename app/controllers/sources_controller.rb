class SourcesController < ApplicationController
  def index
  end

  def edit
    @source = Source.find(params[:id])
    @sources = Source.all

    @grouped_sources = @sources.each_with_object(Hash.new {|h, k| h[k] = []}) { |s, h|
      h[s.catalogued ? "Catalogued" : "Uncatalogued"] << [s.code, s.id]
    }

    last_inclusion = @source.inclusions.order(:order).last
    last_order = last_inclusion&.order || -1

    inclusion = @source.inclusions.build(order: last_order + 1)
    inclusion.piece = Piece.new
    attributions = inclusion.attributions.build
    attributions.anonym = Anonym.new
  end

  def create
    source = Source.create!(source_params)

    redirect_to sources_path
  end

  def update
    source = Source.find(params[:id])
    source.update!(source_params)

    redirect_to edit_source_path(source)
  end

  def switch_to
    redirect_to edit_source_path(params[:id])
  end

private

  def source_params
    params.require(:source).permit(
      :code,
      :title,
      :type,
      :format,
      :date_range,
      :town,
      :sigla,
      :shelfmark,
      :url,
      :catalogued,
      inclusions_attributes: [
        :id,
        :note,
        :order,
        :attributed_to,
        piece_attributes: [
          :id,
          :title,
        ],
      ],
    )
  end
end
